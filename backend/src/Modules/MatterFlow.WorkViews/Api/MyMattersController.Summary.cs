using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>The counts of the Overview (the pre-filter of the grid, issue #942): matters, open, overdue, due in 3 and 7 days, unassigned, on hold (with the age of the oldest hold). Each count carries the query that lists it.</summary>
    [HttpGet("summary", Name = "GetMyMattersSummary")]
    [ProducesResponseType<MyMattersSummary>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersSummary>> GetSummary([FromQuery] MyMattersSummaryQuery query, [FromServices] MyMattersSummaryService summary, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersSummaryQuery.Keys).OrThrow();
        return (await summary.GetAsync(query, cancellationToken)).OrThrow();
    }
}
