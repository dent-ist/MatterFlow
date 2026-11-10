using MatterFlow.SharedKernel.Results;

namespace MatterFlow.SharedKernel.Paging;

/// <summary>Offset paging parameters (architecture section 11): 1-based page, default 25, max 100.</summary>
public sealed record PageRequest(int Page = PageRequest.FirstPage, int PageSize = PageRequest.DefaultPageSize)
{
    public const int FirstPage = 1;
    public const int DefaultPageSize = 25;
    public const int MaxPageSize = 100;

    public int Skip => (Page - 1) * PageSize;

    /// <summary>Returns a failure when page or pageSize are out of range.</summary>
    public static Result<PageRequest> Create(int? page, int? pageSize)
    {
        var p = page ?? FirstPage;
        var s = pageSize ?? DefaultPageSize;
        if (p < 1)
            return Error.Validation("page", "RANGE", "page must be 1 or greater.");
        if (s is < 1 or > MaxPageSize)
            return Error.Validation("pageSize", "RANGE", $"pageSize must be between 1 and {MaxPageSize}.");
        return new PageRequest(p, s);
    }
}

/// <summary>Offset page envelope: <c>{items, total, page, pageSize}</c>.</summary>
public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);

/// <summary>Keyset page envelope for very large lists (audit): pass <c>NextAfterId</c> as <c>afterId</c>.</summary>
public sealed record KeysetPage<T>(IReadOnlyList<T> Items, long? NextAfterId);
