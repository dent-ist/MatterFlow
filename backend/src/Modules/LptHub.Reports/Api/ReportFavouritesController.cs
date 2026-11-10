using MatterFlow.Reports.Application;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Reports.Api;

/// <summary>A report in the person's Recent line.</summary>
/// <param name="ReportId">Id of the report (the run page is <c>/reports/{reportId}</c>).</param>
/// <param name="Name">Name of the report.</param>
/// <param name="CategoryName">Name of the report's category.</param>
/// <param name="LastRunAtUtc">When the person last ran the report successfully (UTC).</param>
public sealed record RecentReportResponse(int ReportId, string Name, string CategoryName, DateTime LastRunAtUtc);

/// <summary>The person's most recent reports, newest first.</summary>
public sealed record RecentReportsResponse(IReadOnlyList<RecentReportResponse> Reports);

/// <summary>
/// Favourites and the Recent line of the reports list (issue #723, <c>Report.Run</c> plus an assignment of the report). Per person: nobody sees another
/// person's favourites or runs. A report the caller may not run answers 404 with the same text as running it.
/// </summary>
[ApiController]
[Route("api/v1/reports")]
[Produces("application/json")]
public class ReportFavouritesController(ReportPersonalService personal) : ControllerBase
{
    /// <summary>
    /// Marks the report as the caller's favourite. Idempotent: 204 whether or not it already was one. 404 for an unknown, inactive or unassigned report,
    /// 409 <c>FAVOURITE_LIMIT_REACHED</c> when the caller already has the most favourites of reports they may run.
    /// </summary>
    [HttpPut("{id:int}/favourite", Name = "AddReportFavourite")]
    [Authorize(Policy = ReportPolicies.Run)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Add(int id, CancellationToken cancellationToken)
    {
        var result = await personal.SetFavouriteAsync(id, true, cancellationToken);
        return result.Problem is { } p ? ReportProblems.Create(this, p) : NoContent();
    }

    /// <summary>Removes the caller's favourite mark. Idempotent: 204 whether or not it was set. 404 for a report the caller may not run.</summary>
    [HttpDelete("{id:int}/favourite", Name = "RemoveReportFavourite")]
    [Authorize(Policy = ReportPolicies.Run)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Remove(int id, CancellationToken cancellationToken)
    {
        var result = await personal.SetFavouriteAsync(id, false, cancellationToken);
        return result.Problem is { } p ? ReportProblems.Create(this, p) : NoContent();
    }

    /// <summary>
    /// The caller's most recent distinct reports by successful run (previews, exports and failed runs do not count), newest first, only reports the
    /// caller may run now. <paramref name="top"/> is 5 when left out and held between 1 and 10.
    /// </summary>
    [HttpGet("recent", Name = "ListRecentReports")]
    [Authorize(Policy = ReportPolicies.Run)]
    [ProducesResponseType<RecentReportsResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Recent([FromQuery] int? top, CancellationToken cancellationToken)
    {
        var result = await personal.RecentAsync(top, cancellationToken);
        return result.Problem is { } p
            ? ReportProblems.Create(this, p)
            : Ok(new RecentReportsResponse(result.Value!.Select(r => new RecentReportResponse(r.ReportId, r.Name, r.CategoryName, r.LastRunAtUtc)).ToList()));
    }
}
