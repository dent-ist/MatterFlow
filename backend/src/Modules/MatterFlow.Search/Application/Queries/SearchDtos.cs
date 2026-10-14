using System.ComponentModel.DataAnnotations;

namespace MatterFlow.Search.Application.Queries;

/// <summary>The searchable object types (the <c>type</c> of a hit and of an advanced search).</summary>
public static class SearchTypes
{
    public const string Client = "client";
    public const string Matter = "matter";
    public const string Project = "project";
    public const string Task = "task";
    public const string Asset = "asset";

    /// <summary>All types, in the order global search returns its groups.</summary>
    public static readonly IReadOnlyList<string> All = [Client, Matter, Project, Task, Asset];
}

/// <summary>
/// One search result. <c>Reference</c> is the business number (Client <c>00343</c>, Matter <c>00343-00012</c>, Task <c>TSK-1042</c>, Asset external
/// reference), <c>Label</c> the name or title, <c>Secondary</c> a short context line. <c>Path</c> is the app route to open it. Projects, Tasks and
/// Assets carry their Matter's reference, name and sensitivity (addendum O: sensitive Matters are badged, never hidden).
/// </summary>
public sealed record SearchHit(
    [property: Required] string Type,
    [property: Required] long Id,
    string? Reference,
    [property: Required] string Label,
    string? Secondary,
    [property: Required] string Path,
    [property: Required] bool IsSensitive,
    string? MatterRef,
    string? MatterName,
    [property: Required] bool IsActive,
    string? Status);

/// <summary>The hits of one type, best first and capped; <c>HasMore</c> says the cap cut off further matches.</summary>
public sealed record SearchGroup(
    [property: Required] string Type,
    [property: Required] IReadOnlyList<SearchHit> Items,
    [property: Required] bool HasMore);

/// <summary>Global search result: one group per searchable type the caller may view (and asked for), in a fixed order.</summary>
/// <param name="Query">The trimmed input.</param>
/// <param name="Normalized">What a number input was understood as (<c>00343-00012</c>); null for text.</param>
public sealed record SearchResponse(
    [property: Required] string Query,
    string? Normalized,
    [property: Required] IReadOnlyList<SearchGroup> Groups);

/// <summary>One page of an advanced search over a single object type.</summary>
public sealed record AdvancedSearchPage(
    [property: Required] string Type,
    [property: Required] IReadOnlyList<SearchHit> Items,
    [property: Required] int Total,
    [property: Required] int Page,
    [property: Required] int PageSize);
