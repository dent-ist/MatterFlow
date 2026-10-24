using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>
    /// Trends of the matters in scope, week by week (Monday to Sunday in the viewer's zone) for 8 (default), 12 or 26 weeks: tasks created and completed per week, tasks overdue at the end of each week, and today's
    /// figures (open, average age, on hold). Approximate by design (<c>approximate</c> is true and <c>limitations</c> says why): the schema keeps no history of due dates or statuses, so the series are derived from the
    /// current columns. The date range is ignored: the weeks are the range.
    /// </summary>
    [HttpGet("trends", Name = "GetMyMattersTrends")]
    [ProducesResponseType<MyMattersTrends>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersTrends>> GetTrends([FromQuery] MyMattersTrendsQuery query, [FromServices] MyMattersTrendsService trends, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersTrendsQuery.Keys).OrThrow();
        return (await trends.GetAsync(query, cancellationToken)).OrThrow();
    }
}
