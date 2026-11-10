using MatterFlow.Identity.Contracts;
using MatterFlow.Search.Application.Queries;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Search.Api;

/// <summary>
/// Global and advanced search (architecture 14). A caller needs at least one object type's View permission; each type is searched, and its hits
/// returned, only when the caller may view that type (Client.View, Matter.View, Project.View, Task.View, Asset.View). Everyone with Task.View sees
/// every Task (addendum E). Plain SQL, case-insensitive, number-aware; there is no full-text or search service.
/// </summary>
[ApiController]
[Route("api/v1/search")]
[MatterFlow.SharedKernel.Visibility.PreparesViewer]
public class SearchController(SearchService search) : ControllerBase
{
    /// <summary>Any one of the View permissions opens the search endpoints (the types the caller may not view are left out of the results).</summary>
    private const string AnyViewPolicy = "Perm:" + Permissions.Client.View + "|" + Permissions.Matter.View + "|" + Permissions.Project.View
        + "|" + Permissions.Task.View + "|" + Permissions.Asset.View;

    /// <summary>
    /// Typeahead and results-page search across Clients, Matters, Projects, Tasks and Assets, grouped by type and capped per type (default 5).
    /// <c>q</c> needs at least 2 characters. Numbers match padded or unpadded (<c>343</c>, <c>00343</c>, <c>343-12</c>, <c>TSK-1042</c>); text matches
    /// anywhere, ranked exact number, then start of value, then start of a word, then anywhere. <c>%</c>, <c>_</c> and <c>[</c> are matched literally.
    /// </summary>
    [HttpGet(Name = "Search")]
    [Authorize(Policy = AnyViewPolicy)]
    [ProducesResponseType<SearchResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<SearchResponse>> Get([FromQuery] GlobalSearchQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, GlobalSearchQuery.Keys).OrThrow();
        return (await search.SearchAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>
    /// Paged search over one object type with that type's filters (see <see cref="AdvancedSearchQuery"/>). Requires the View permission of the
    /// chosen type. The text is optional and matched like the global search; without it results are ordered by name.
    /// </summary>
    [HttpGet("advanced", Name = "AdvancedSearch")]
    [Authorize(Policy = AnyViewPolicy)]
    [ProducesResponseType<AdvancedSearchPage>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<AdvancedSearchPage>> Advanced([FromQuery] AdvancedSearchQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, AdvancedSearchQuery.Keys).OrThrow();
        return (await search.AdvancedAsync(query, cancellationToken)).OrThrow();
    }
}
