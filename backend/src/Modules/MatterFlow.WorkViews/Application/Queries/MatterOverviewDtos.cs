using System.ComponentModel.DataAnnotations;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>A matter's project manager as the overview header shows them. No manager is normal and is never a warning.</summary>
public sealed record MatterOverviewManager([property: Required] int UserId, [property: Required] string DisplayName, [property: Required] bool IsActive);

/// <summary>The matter header of the overview.</summary>
public sealed record MatterOverviewHeader(
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string Name,
    [property: Required] int ClientId,
    [property: Required] string ClientName,
    [property: Required] bool IsActive,
    [property: Required] bool IsSensitive,
    MatterOverviewManager? PrimaryManager,
    MatterOverviewManager? SecondaryManager);

/// <summary>
/// Tasks of the matter by status, each with the Task Queue query that lists exactly the counted tasks. <c>Completed</c> counts the tasks completed in the last 30 days (the viewer's days);
/// <c>Open</c> is New + In progress + On hold.
/// </summary>
public sealed record MatterOverviewTaskCounts(
    [property: Required] int New,
    [property: Required] int InProgress,
    [property: Required] int OnHold,
    [property: Required] int Completed,
    [property: Required] int Open,
    [property: Required] string NewQuery,
    [property: Required] string InProgressQuery,
    [property: Required] string OnHoldQuery,
    [property: Required] string CompletedQuery,
    [property: Required] string OpenQuery);

/// <summary>One of the next deadlines: an open, not overdue task with an explicit due date.</summary>
public sealed record MatterOverviewDeadline(
    [property: Required] long TaskId,
    [property: Required] string TaskNumber,
    [property: Required] string Title,
    DateOnly? DueDate,
    DateTime? DueAtUtc,
    int? AssigneeId,
    string? AssigneeName);

/// <summary>The next deadlines of the matter, soonest first.</summary>
/// <param name="Total">All open, not overdue tasks with a due date (the items are the first five).</param>
/// <param name="Query">The Task Queue query that lists all of them, soonest first.</param>
public sealed record MatterOverviewDeadlines([property: Required] int Total, [property: Required] string Query, [property: Required] IReadOnlyList<MatterOverviewDeadline> Items);

/// <summary>A person with open tasks on the matter. <c>Overdue</c> and <c>Away</c> are two facts side by side; nothing judges the combination.</summary>
public sealed record MatterOverviewPerson(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    [property: Required] bool IsActive,
    [property: Required] int Open,
    [property: Required] int Overdue,
    MyMattersAwayWindow? Away,
    [property: Required] string Query);

/// <summary>Who works on the matter: people with open tasks on it, most open tasks first (at most ten), and how many open tasks have no person.</summary>
/// <param name="Total">How many people hold open tasks on the matter (more than <c>Items</c> holds when it was cut).</param>
public sealed record MatterOverviewPeople(
    [property: Required] int Total,
    [property: Required] int UnassignedOpen,
    [property: Required] IReadOnlyList<MatterOverviewPerson> Items);

/// <summary>An active asset of the matter.</summary>
public sealed record MatterOverviewAsset([property: Required] int AssetId, [property: Required] string DisplayName, [property: Required] string AssetTypeName, string? ExternalReference);

/// <summary>The matter's active assets: the count and the first five by name. Present only for a caller with <c>Asset.View</c>.</summary>
public sealed record MatterOverviewAssets([property: Required] int Total, [property: Required] IReadOnlyList<MatterOverviewAsset> Items);

/// <summary>One reason of the health flag, in words first: a code, how many tasks, and the Task Queue query that lists them.</summary>
/// <param name="Code"><c>OVERDUE</c>, <c>UNASSIGNED</c>, <c>DUE_SOON</c>, <c>LONG_HOLD</c> or <c>NO_OPEN_TASKS</c>.</param>
public sealed record MatterOverviewReason([property: Required] string Code, [property: Required] int Count, string? Query);

/// <summary>The same flag and reasons as the My Matters health table (Red, Amber, Green); who manages the matter never enters it.</summary>
public sealed record MatterOverviewHealth([property: Required] string Flag, [property: Required] IReadOnlyList<MatterOverviewReason> Reasons, [property: Required] int AmberDueDays, [property: Required] int StuckOnHoldDays);

/// <summary>
/// The matter record Overview in one round trip (epic #758, PX-11). A section the caller may not use is null, not an empty list: the task sections need <c>Task.View</c>, the assets need <c>Asset.View</c>.
/// </summary>
/// <param name="Activity">The last ten events of the last 90 days (task created, status changed, reassigned, commented, manager changed), newest first; never moves the unread marker.</param>
public sealed record MatterOverview(
    [property: Required] string TimeZone,
    [property: Required] DateTime AsOfUtc,
    [property: Required] MatterOverviewHeader Matter,
    MatterOverviewTaskCounts? TaskCounts,
    MatterOverviewDeadlines? Deadlines,
    MatterOverviewPeople? People,
    MatterOverviewAssets? Assets,
    IReadOnlyList<MyMattersActivityItem>? Activity,
    MatterOverviewHealth? Health);
