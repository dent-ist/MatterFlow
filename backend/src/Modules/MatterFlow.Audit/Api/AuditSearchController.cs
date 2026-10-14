using System.ComponentModel.DataAnnotations;
using MatterFlow.Audit.Application;
using MatterFlow.SharedKernel.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Audit.Api;

/// <summary>The admin audit browser: search across all audit events (newest first). Requires the <c>Audit.View</c> policy.</summary>
[ApiController]
[Route("api/v1/audit")]
[Authorize(Policy = PolicyNames.AuditView)]
public class AuditSearchController(AuditSearchService search) : ControllerBase
{
    /// <summary>
    /// Searches the audit trail. Filters combine with AND. <c>from</c> and <c>to</c> are calendar days (<c>yyyy-MM-dd</c>, <c>to</c> inclusive) in
    /// the viewer's time zone (<c>X-Time-Zone</c>). <c>q</c> matches the stored summary or the field key. Paging is by cursor, newest first;
    /// the page size is capped at 200. Secrets and tokens are masked.
    /// </summary>
    /// <param name="objectType">Object type, for example <c>Task</c>.</param>
    /// <param name="objectId">Object id; needs <c>objectType</c>.</param>
    /// <param name="actor">Acting user id.</param>
    /// <param name="eventType">Event code, for example <c>TASK_STATUS_CHANGED</c>.</param>
    /// <param name="from">First day (viewer's zone), <c>yyyy-MM-dd</c>.</param>
    /// <param name="to">Last day (viewer's zone, inclusive), <c>yyyy-MM-dd</c>.</param>
    /// <param name="q">Free text on the summary or field key.</param>
    /// <param name="correlationId">Only the events of one operation (a bulk action).</param>
    /// <param name="cursor">The <c>nextCursor</c> of the previous page.</param>
    /// <param name="pageSize">Items per page (default 50, max 200).</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("search", Name = "SearchAuditEvents")]
    [ProducesResponseType<AuditSearchPage>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<AuditSearchPage>> Search(
        [FromQuery, StringLength(40)] string? objectType,
        [FromQuery, StringLength(40)] string? objectId,
        [FromQuery, Range(1, int.MaxValue)] int? actor,
        [FromQuery, StringLength(64)] string? eventType,
        [FromQuery, StringLength(10)] string? from,
        [FromQuery, StringLength(10)] string? to,
        [FromQuery, StringLength(200)] string? q,
        [FromQuery] Guid? correlationId,
        [FromQuery, Range(1, long.MaxValue)] long? cursor,
        [FromQuery, Range(1, AuditSearchService.MaxPageSize)] int pageSize = AuditSearchService.DefaultPageSize,
        CancellationToken cancellationToken = default) =>
        await search.SearchAsync(
            new AuditSearchFilter(objectType, objectId, actor, eventType, from, to, q, correlationId, cursor, pageSize),
            cancellationToken);

    /// <summary>The object types and event types present in the audit trail (for the filter lists).</summary>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("facets", Name = "GetAuditFacets")]
    [ProducesResponseType<AuditFacets>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<AuditFacets>> Facets(CancellationToken cancellationToken = default) =>
        await search.FacetsAsync(cancellationToken);
}
