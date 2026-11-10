using System.ComponentModel.DataAnnotations;
using MatterFlow.SharedKernel.Paging;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Search.Application.Queries;

/// <summary>Query string of <c>GET /api/v1/search</c> (camelCase). Unknown parameters are a 400.</summary>
public class GlobalSearchQuery
{
    public const int DefaultLimit = 5;
    public const int MaxLimit = 50;

    /// <summary>The query parameters the endpoint accepts.</summary>
    public static readonly IReadOnlyList<string> Keys = ["q", "types", "limit"];

    /// <summary>Text to find: at least 2 characters. A number (<c>343</c>, <c>00343</c>, <c>343-12</c>, <c>TSK-1042</c>) is matched in its padded and unpadded forms.</summary>
    [FromQuery(Name = "q"), StringLength(SearchTerm.MaxLength)]
    public string? Q { get; init; }

    /// <summary>Object types to search (<c>client</c>, <c>matter</c>, <c>project</c>, <c>task</c>, <c>asset</c>); repeat the parameter or use a comma list. Default: all the caller may view.</summary>
    [FromQuery(Name = "types")]
    public string[]? Types { get; init; }

    /// <summary>Hits per type (default 5, at most 50).</summary>
    [FromQuery(Name = "limit"), Range(1, MaxLimit)]
    public int? Limit { get; init; }
}

/// <summary>
/// Query string of <c>GET /api/v1/search/advanced</c> (camelCase). Which filters apply depends on <c>type</c>: Matter (<c>client</c>, <c>active</c>,
/// <c>sensitive</c>), Client (<c>active</c>), Task (<c>status</c>, <c>client</c>, <c>matter</c>, <c>project</c>, <c>requestor</c>, the Task Queue names),
/// Project (<c>matter</c>, <c>active</c>), Asset (<c>matter</c>, <c>assetType</c>, <c>active</c>). A filter that does not apply to the type is a 400.
/// </summary>
public class AdvancedSearchQuery
{
    /// <summary>The query parameters the endpoint accepts.</summary>
    public static readonly IReadOnlyList<string> Keys =
        ["type", "q", "client", "matter", "project", "assetType", "active", "sensitive", "status", "requestor", "page", "pageSize"];

    /// <summary>Object type: <c>client</c>, <c>matter</c>, <c>project</c>, <c>task</c> or <c>asset</c>.</summary>
    [FromQuery(Name = "type")]
    public string? Type { get; init; }

    /// <summary>Optional text (2 or more characters), matched like the global search.</summary>
    [FromQuery(Name = "q"), StringLength(SearchTerm.MaxLength)]
    public string? Q { get; init; }

    /// <summary>Client id (Matters and Tasks).</summary>
    [FromQuery(Name = "client")]
    public int? Client { get; init; }

    /// <summary>Matter id (Projects, Tasks, Assets).</summary>
    [FromQuery(Name = "matter")]
    public int? Matter { get; init; }

    /// <summary>Project id (Tasks).</summary>
    [FromQuery(Name = "project")]
    public int? Project { get; init; }

    /// <summary>Asset type id (Assets).</summary>
    [FromQuery(Name = "assetType")]
    public int? AssetType { get; init; }

    /// <summary>Active (true) or inactive (false) records (Clients, Matters, Projects, Assets).</summary>
    [FromQuery(Name = "active")]
    public bool? Active { get; init; }

    /// <summary>Sensitive (true) or ordinary (false) Matters.</summary>
    [FromQuery(Name = "sensitive")]
    public bool? Sensitive { get; init; }

    /// <summary>Task status codes (<c>NEW</c>, <c>IN_PROGRESS</c>, <c>ON_HOLD</c>, <c>COMPLETED</c>, <c>CANCELLED</c>); repeatable.</summary>
    [FromQuery(Name = "status")]
    public string[]? Status { get; init; }

    /// <summary>Requestor name or email fragment (Tasks).</summary>
    [FromQuery(Name = "requestor"), StringLength(200)]
    public string? Requestor { get; init; }

    /// <summary>1-based page number.</summary>
    [FromQuery(Name = "page"), Range(1, int.MaxValue)]
    public int Page { get; init; } = PageRequest.FirstPage;

    /// <summary>Items per page (default 25, at most 100).</summary>
    [FromQuery(Name = "pageSize"), Range(1, PageRequest.MaxPageSize)]
    public int PageSize { get; init; } = PageRequest.DefaultPageSize;
}
