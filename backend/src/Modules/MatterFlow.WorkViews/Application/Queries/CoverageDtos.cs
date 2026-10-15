using System.ComponentModel.DataAnnotations;
using MatterFlow.Identity.Contracts;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>Query of the Dashboard task type coverage matrix (epic #68, issue #73 addendum Q).</summary>
public class CoverageQuery
{
    public static readonly IReadOnlyList<string> Keys = ["from", "to", "periodDays", "podId", "includeInactive"];

    /// <summary>First local day of the period (<c>yyyy-MM-dd</c>, the viewer's zone). Needs <c>to</c>.</summary>
    [FromQuery(Name = "from")]
    public DateOnly? From { get; init; }

    /// <summary>Last local day of the period, included. Needs <c>from</c>; at most 366 days after it.</summary>
    [FromQuery(Name = "to")]
    public DateOnly? To { get; init; }

    /// <summary>A period of this many days ending today (default 30, at most 366); ignored when <c>from</c> and <c>to</c> are given.</summary>
    [FromQuery(Name = "periodDays"), Range(1, 366)]
    public int? PeriodDays { get; init; }

    /// <summary>Only members of this Pod.</summary>
    [FromQuery(Name = "podId")]
    public int? PodId { get; init; }

    /// <summary>Also list inactive users who completed something in the period (default true).</summary>
    [FromQuery(Name = "includeInactive")]
    public bool? IncludeInactive { get; init; }
}

public static class CoverageRules
{
    public const int DefaultDays = 30;
    public const int MaxDays = 366;
}

/// <summary>A task type row of the matrix: its total in the period and how many of the listed people completed at least one.</summary>
public sealed record CoverageTaskType(int TaskTypeId, string Name, string IconKey, bool IsActive, int Total, int PeopleWhoHandledIt);

/// <summary>A person column of the matrix. The availability only marks the column (out of office does not change the counts).</summary>
public sealed record CoverageUser(int UserId, string DisplayName, string Initials, IReadOnlyList<WorkloadPod> Pods, bool IsActive, UserAvailabilitySummary Availability, int Total);

/// <summary>Tasks of one type completed by one person; only non-zero cells are listed (the matrix fills in zeros).</summary>
public sealed record CoverageCell(int UserId, int TaskTypeId, int Completed);

/// <summary>Strip figures: task types with fewer than two people who handled them (a coverage insight, not a ranking).</summary>
public sealed record CoverageSummary(int TaskTypes, int Users, int TypesWithFewerThanTwoPeople, int TotalCompleted);

/// <summary>
/// Completed Tasks per person per task type in a period, for training and cross-coverage planning (addendum Q). A Task counts for its assigned
/// person when it completed (only COMPLETED, not cancelled).
/// </summary>
public sealed record CoverageBoard(
    string TimeZone,
    DateTime GeneratedAtUtc,
    string From,
    string To,
    int Days,
    IReadOnlyList<CoverageTaskType> TaskTypes,
    IReadOnlyList<CoverageUser> Users,
    IReadOnlyList<CoverageCell> Cells,
    CoverageSummary Summary);
