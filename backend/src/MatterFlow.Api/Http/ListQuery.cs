using System.ComponentModel.DataAnnotations;
using MatterFlow.SharedKernel.Paging;

namespace MatterFlow.Api.Http;

/// <summary>Standard list query: offset paging plus the whitelisted <c>sort</c> expression. Resource-specific filters derive from or accompany this.</summary>
public class ListQuery
{
    /// <summary>1-based page number.</summary>
    [Range(1, int.MaxValue)]
    public int Page { get; init; } = PageRequest.FirstPage;

    /// <summary>Items per page (default 25, max 100).</summary>
    [Range(1, PageRequest.MaxPageSize)]
    public int PageSize { get; init; } = PageRequest.DefaultPageSize;

    /// <summary>Comma-separated sort fields; prefix with <c>-</c> for descending, e.g. <c>priority,-dueAt</c>.</summary>
    [StringLength(200)]
    public string? Sort { get; init; }

    public PageRequest ToPageRequest() => new(Page, PageSize);
}
