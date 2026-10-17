using System.ComponentModel.DataAnnotations;
using MatterFlow.Identity.Contracts;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>Query of the Dashboard Swimlane board (camelCase query string). Unknown parameters are a 400.</summary>
public class SwimlaneQuery
{
    public static readonly IReadOnlyList<string> Keys =
        ["completedDays", "groupBy", "sort", "podId", "assigneeId", "taskTypeId", "priorityId", "q", "overdueOnly", "mine", "podScope"];

    /// <summary>The Completed lane shows Tasks completed or cancelled in the last this-many days counting today, in the viewer's zone (default 7, max 30).</summary>
    [FromQuery(Name = "completedDays"), Range(1, SwimlaneRules.MaxCompletedDays)]
    public int CompletedDays { get; init; } = SwimlaneRules.DefaultCompletedDays;

    /// <summary><c>none</c> (default), <c>priority</c>, <c>assignee</c> or <c>clientMatter</c>: which <c>groups</c> metadata to return (cards are always a flat list per lane).</summary>
    [FromQuery(Name = "groupBy"), StringLength(20)]
    public string? GroupBy { get; init; }

    /// <summary><c>priority</c> (default: priority rank, ASAP first, due date, oldest), <c>due</c>, <c>clientMatter</c> or <c>created</c> (newest first).</summary>
    [FromQuery(Name = "sort"), StringLength(20)]
    public string? Sort { get; init; }

    /// <summary>Deprecated, kept for one release: the same as <c>podScope=&lt;id&gt;</c>. <c>podScope</c> wins.</summary>
    [FromQuery(Name = "podId")]
    public int? PodId { get; init; }

    /// <summary>A user id, or <c>unassigned</c> for Tasks without a person.</summary>
    [FromQuery(Name = "assigneeId"), StringLength(20)]
    public string? AssigneeId { get; init; }

    /// <summary>Only Tasks of this Task Type.</summary>
    [FromQuery(Name = "taskTypeId")]
    public int? TaskTypeId { get; init; }

    /// <summary>Only Tasks of this Priority.</summary>
    [FromQuery(Name = "priorityId")]
    public int? PriorityId { get; init; }

    /// <summary>Text matched (case-insensitive, partial) against the title and the Task number.</summary>
    [FromQuery(Name = "q"), StringLength(200)]
    public string? Q { get; init; }

    /// <summary>True: only open overdue Tasks (the Completed lane is then empty).</summary>
    [FromQuery(Name = "overdueOnly")]
    public bool? OverdueOnly { get; init; }

    /// <summary>True: only Tasks assigned to the caller.</summary>
    [FromQuery(Name = "mine")]
    public bool? Mine { get; init; }

    /// <summary>The page-wide scope (P1, #89): <c>all</c> (default), <c>mine</c> (the caller's active Pods, resolved on the server) or a Pod id. A Pod that does not exist is 400 <c>UNKNOWN_POD</c>; one the caller may not see is 403.</summary>
    [FromQuery(Name = "podScope"), StringLength(20)]
    public string? PodScope { get; init; }
}

/// <summary>Constants of the swimlane board.</summary>
public static class SwimlaneRules
{
    public const int DefaultCompletedDays = 7;
    public const int MaxCompletedDays = 30;

    /// <summary>Cards returned per lane; a lane with more says so (<c>truncated</c>, <c>total</c>).</summary>
    public const int LaneCap = 200;

    public const string GroupNone = "none";
    public const string GroupPriority = "priority";
    public const string GroupAssignee = "assignee";
    public const string GroupClientMatter = "clientMatter";

    public const string SortPriority = "priority";
    public const string SortDue = "due";
    public const string SortClientMatter = "clientMatter";
    public const string SortCreated = "created";

    public static readonly IReadOnlyList<string> GroupBys = [GroupNone, GroupPriority, GroupAssignee, GroupClientMatter];
    public static readonly IReadOnlyList<string> Sorts = [SortPriority, SortDue, SortClientMatter, SortCreated];
}

/// <summary>A Priority on a card. <c>color</c> is the badge token (<c>critical</c>, <c>high</c>, <c>normal</c>, <c>low</c>, <c>neutral</c>) or a <c>#RRGGBB</c> override, exactly what the priority badge takes; <c>rank</c> is the sort order (lower is more urgent).</summary>
public sealed record SwimlanePriority([property: Required] int PriorityId, [property: Required] string Label, [property: Required] string Color, [property: Required] int Rank);

/// <summary>The person a card is assigned to, with their availability right now (a soft hint, never a rating).</summary>
public sealed record SwimlaneAssignee(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    [property: Required] bool IsActive,
    [property: Required] UserAvailabilitySummary Availability);

/// <summary>One Task card. Due is as stored; <c>isAsap</c> and <c>isOverdue</c> are evaluated for the viewer's zone. <c>rowVersion</c> is for the inline menus.</summary>
public sealed record SwimlaneCard(
    [property: Required] long TaskId,
    [property: Required] string Ref,
    [property: Required] string Title,
    [property: Required] string Status,
    [property: Required] string StatusLabel,
    [property: Required] SwimlanePriority Priority,
    SwimlaneAssignee? Assignee,
    QueuePod? Pod,
    [property: Required] int ClientId,
    [property: Required] string ClientNumber,
    [property: Required] string ClientName,
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] bool MatterIsSensitive,
    [property: Required] int TaskTypeId,
    [property: Required] string TaskTypeName,
    [property: Required] string TaskTypeIconKey,
    DateOnly? DueDate,
    DateTime? DueAtUtc,
    [property: Required] bool IsOverdue,
    [property: Required] bool IsAsap,
    [property: Required] int StepsResolved,
    [property: Required] int StepsTotal,
    [property: Required] DateTime CreatedAtUtc,
    DateTime? CompletedAtUtc,
    [property: Required] string RowVersion);

/// <summary>A lane: <c>NEW</c>, <c>IN_PROGRESS</c>, <c>ON_HOLD</c> or <c>COMPLETED</c> (Completed holds completed and cancelled Tasks of the window).</summary>
/// <param name="Count">All Tasks that belong in the lane, also those beyond the cap.</param>
/// <param name="Truncated">True when <c>count</c> exceeds the cap and only the first cards are returned.</param>
/// <param name="Total">Same as <c>count</c>; the UI shows "Showing 200 of N, open the Task Queue".</param>
public sealed record SwimlaneLane(
    [property: Required] string Status,
    [property: Required] string Label,
    [property: Required] int Count,
    [property: Required] bool Truncated,
    [property: Required] int Total,
    [property: Required] IReadOnlyList<SwimlaneCard> Cards);

/// <summary>Tasks of a group per lane.</summary>
public sealed record SwimlaneLaneCounts(
    [property: Required] int New,
    [property: Required] int InProgress,
    [property: Required] int OnHold,
    [property: Required] int Completed);

/// <summary>
/// A group of the requested <c>groupBy</c>. <c>kind</c> is <c>priority</c>, <c>assignee</c>, <c>client</c> or <c>matter</c>; for client groups <c>children</c> holds
/// the matters (a tree). <c>key</c> is stable (<c>priority:3</c>, <c>assignee:7</c>, <c>assignee:unassigned</c>, <c>client:12</c>, <c>matter:40</c>).
/// </summary>
public sealed record SwimlaneGroup(
    [property: Required] string Key,
    [property: Required] string Kind,
    int? Id,
    [property: Required] string Label,
    string? ClientNumber,
    string? MatterRef,
    string? Color,
    int? Rank,
    [property: Required] int Count,
    [property: Required] SwimlaneLaneCounts Counts,
    [property: Required] IReadOnlyList<SwimlaneGroup> Children);

/// <summary>The swimlane board. Counts and groups cover every matching Task, cards are capped per lane.</summary>
public sealed record SwimlaneBoard(
    [property: Required] string TimeZone,
    [property: Required] DateTime GeneratedAtUtc,
    [property: Required] int CompletedDays,
    [property: Required] DateOnly CompletedFrom,
    [property: Required] string GroupBy,
    [property: Required] string Sort,
    [property: Required] int LaneCap,
    [property: Required] IReadOnlyList<SwimlaneLane> Lanes,
    [property: Required] IReadOnlyList<SwimlaneGroup> Groups);
