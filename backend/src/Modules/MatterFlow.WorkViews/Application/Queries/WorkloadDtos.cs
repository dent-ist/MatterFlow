using System.ComponentModel.DataAnnotations;
using MatterFlow.Identity.Contracts;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>Query of the Dashboard Users tab (team workload).</summary>
public class WorkloadQuery
{
    public static readonly IReadOnlyList<string> Keys = ["podId", "availability", "q"];

    /// <summary>Only members of this Pod. The open Task counts still cover all of the person's open Tasks.</summary>
    [FromQuery(Name = "podId")]
    public int? PodId { get; init; }

    /// <summary><c>all</c> (default), <c>available</c> (not out of office; off hours counts as available) or <c>out</c> (out of office).</summary>
    [FromQuery(Name = "availability"), StringLength(20)]
    public string? Availability { get; init; }

    /// <summary>Fragment of the person's name.</summary>
    [FromQuery(Name = "q"), StringLength(200)]
    public string? Q { get; init; }
}

/// <summary>Constants of the team workload.</summary>
public static class WorkloadRules
{
    public const string AvailabilityAll = "all";
    public const string AvailabilityAvailable = "available";
    public const string AvailabilityOut = "out";

    public const string LoadIdle = "IDLE";
    public const string LoadLight = "LIGHT";
    public const string LoadNormal = "NORMAL";
    public const string LoadHeavy = "HEAVY";

    public static readonly IReadOnlyList<string> AvailabilityFilters = [AvailabilityAll, AvailabilityAvailable, AvailabilityOut];

    /// <summary>IDLE with no open Tasks, LIGHT up to <paramref name="lightMax"/>, NORMAL up to <paramref name="normalMax"/>, otherwise HEAVY.</summary>
    public static string LoadLevel(int openTotal, int lightMax, int normalMax) =>
        openTotal <= 0 ? LoadIdle : openTotal <= lightMax ? LoadLight : openTotal <= normalMax ? LoadNormal : LoadHeavy;

    /// <summary>Up to two capital letters: first letters of the first and last word (the part after <c>DOMAIN\</c> for a bare account name).</summary>
    public static string Initials(string? displayName)
    {
        var name = displayName?.Trim() ?? string.Empty;
        var slash = name.LastIndexOf('\\');
        if (slash >= 0 && slash < name.Length - 1)
            name = name[(slash + 1)..];

        var words = name.Split([' ', '.', '-', '_'], StringSplitOptions.RemoveEmptyEntries);
        return words.Length switch
        {
            0 => "?",
            1 => words[0].Length > 1 ? words[0][..2].ToUpperInvariant() : words[0].ToUpperInvariant(),
            _ => string.Concat(char.ToUpperInvariant(words[0][0]), char.ToUpperInvariant(words[^1][0])),
        };
    }
}

/// <summary>A Priority of the legend (all active priorities in rank order). <c>color</c> is the badge token or <c>#RRGGBB</c>; <c>rank</c> is lower for more urgent.</summary>
public sealed record WorkloadPriority([property: Required] int PriorityId, [property: Required] string Label, [property: Required] string Color, [property: Required] int Rank);

/// <summary>Open Tasks of one Priority.</summary>
public sealed record WorkloadPriorityCount([property: Required] int PriorityId, [property: Required] int Count);

/// <summary>The highest-ranked Priority that has open Tasks, with its count.</summary>
public sealed record WorkloadTopPriority(
    [property: Required] int PriorityId,
    [property: Required] string Label,
    [property: Required] string Color,
    [property: Required] int Rank,
    [property: Required] int Count);

/// <summary>A Pod the person belongs to.</summary>
public sealed record WorkloadPod([property: Required] int PodId, [property: Required] string Name, [property: Required] bool IsPrimary);

/// <summary>The open Task with the earliest explicit due date (ASAP Tasks have none).</summary>
public sealed record WorkloadNextDue([property: Required] long TaskId, [property: Required] string Ref, DateOnly? DueDate, DateTime? DueAtUtc, [property: Required] bool IsOverdue);

/// <summary>One person. Operational counts only: no completion statistics, speed or ranking.</summary>
/// <param name="ByPriority">One entry per legend Priority, in the legend's order (zero counts included).</param>
/// <param name="LoadLevel"><c>IDLE</c>, <c>LIGHT</c>, <c>NORMAL</c> or <c>HEAVY</c> from <c>openTotal</c> against <c>Dashboard:Workload:LightMax</c> and <c>NormalMax</c>.</param>
public sealed record WorkloadUser(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    [property: Required] string Initials,
    [property: Required] IReadOnlyList<WorkloadPod> Pods,
    [property: Required] UserAvailabilitySummary Availability,
    [property: Required] IReadOnlyList<WorkloadPriorityCount> ByPriority,
    [property: Required] int OpenTotal,
    [property: Required] int Overdue,
    [property: Required] int DueSoon,
    [property: Required] int OnHold,
    WorkloadTopPriority? TopPriority,
    WorkloadNextDue? NextDue,
    [property: Required] string LoadLevel);

/// <summary>Team totals (before the availability and name filters). <c>available</c>: not out of office and no open Tasks; <c>busy</c>: not out of office with open Tasks.</summary>
public sealed record WorkloadSummary(
    [property: Required] int Available,
    [property: Required] int Busy,
    [property: Required] int OutOfOffice,
    [property: Required] int UnassignedTasks,
    [property: Required] int Total);

/// <summary>The thresholds in force.</summary>
public sealed record WorkloadThresholds([property: Required] int LightMax, [property: Required] int NormalMax);

/// <summary>The team workload board: one entry per active user who can hold work.</summary>
public sealed record WorkloadBoard(
    [property: Required] string TimeZone,
    [property: Required] DateTime GeneratedAtUtc,
    [property: Required] IReadOnlyList<WorkloadPriority> Priorities,
    [property: Required] IReadOnlyList<WorkloadUser> Users,
    [property: Required] WorkloadSummary Summary,
    [property: Required] WorkloadThresholds Thresholds);
