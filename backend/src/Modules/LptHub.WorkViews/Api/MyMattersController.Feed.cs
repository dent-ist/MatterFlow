using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>
    /// The recent activity feed of the scope, newest first, in six kinds: <c>NEW_ASSETS</c>, <c>NEW_COMMENTS</c> (the event only, never the text), <c>NEW_STATUS_UPDATES</c> (any status change except to On Hold), <c>ON_HOLD</c> and
    /// <c>OVERDUE</c> (the current state of tasks; Overdue is New or In Progress and past due) and <c>DUE_DATE_UPDATED</c>. Filters: <c>kind</c> (repeatable), <c>days</c> (window of the event kinds, default 30), <c>unread=true</c>, <c>page</c>, <c>pageSize</c>.
    /// The unread marker is the one <c>POST /my-matters/activity/seen</c> moves; the first call creates it, so nothing is unread on the first visit.
    /// </summary>
    [HttpGet("feed", Name = "GetMyMattersFeed")]
    [ProducesResponseType<MyMattersFeed>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersFeed>> GetFeed([FromQuery] MyMattersFeedQuery query, [FromServices] MyMattersFeedService feed, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersFeedQuery.Keys).OrThrow();
        return (await feed.GetAsync(query, cancellationToken)).OrThrow();
    }
}
