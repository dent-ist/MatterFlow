using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>Marks activity as read: everything up to <c>upToEventId</c>, or everything up to now. The marker only moves forward and belongs to the caller alone.</summary>
    [HttpPost("activity/seen", Name = "MarkMyMattersActivitySeen")]
    [ProducesResponseType<MyMattersActivitySeen>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersActivitySeen>> MarkSeen([FromBody] MarkActivitySeenRequest request, [FromServices] MyMattersActivityService activity, CancellationToken cancellationToken) =>
        (await activity.MarkSeenAsync(request.UpToEventId, cancellationToken)).OrThrow();
}
