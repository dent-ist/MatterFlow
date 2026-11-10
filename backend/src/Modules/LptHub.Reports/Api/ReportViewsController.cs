using LptHub.Reports.Application;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace LptHub.Reports.Api;

/// <summary>A saved view of the person's result grid for one report.</summary>
/// <param name="ViewId">Id of the view (unique across people; only its owner can use it).</param>
/// <param name="Name">The person's name for the view (at most 80 characters, unique per person and report, case-insensitive).</param>
/// <param name="IsDefault">True for the one view applied automatically to a new result of this report.</param>
/// <param name="Layout">Column order, hidden columns, widths, sort, filters and page size.</param>
/// <param name="IgnoredColumns">Only on a save: columns the person's live result does not have, left out of the stored view.</param>
public sealed record ReportViewResponse(int ViewId, string Name, bool IsDefault, ReportViewLayout Layout, DateTime CreatedAtUtc, DateTime? ModifiedAtUtc, IReadOnlyList<string> IgnoredColumns);

/// <summary>The person's views of one report, default first, then by name.</summary>
/// <param name="Limit">The most views one person can keep per report.</param>
public sealed record ReportViewListResponse(IReadOnlyList<ReportViewResponse> Views, int Limit);

/// <summary>Saves a new view.</summary>
/// <param name="Name">Required, at most 80 characters.</param>
/// <param name="Layout">Required. Columns the person's live result does not have are dropped.</param>
/// <param name="IsDefault">True to make it the default view (the previous default is cleared).</param>
public sealed record CreateReportViewRequest(string? Name, ReportViewLayout? Layout, bool IsDefault);

/// <summary>Renames a view, replaces its layout, or both (a missing member is left as it is).</summary>
public sealed record UpdateReportViewRequest(string? Name, ReportViewLayout? Layout);

/// <summary>
/// Saved views of the result grid (issue #722, <c>Report.Run</c> plus an assignment of the report). Per person and report: another person's view and a
/// view of a report the caller may not run both answer 404. A view is layout only; it never holds parameter values or data.
/// </summary>
[ApiController]
[Route("api/v1/reports/{reportId:int}/views")]
[Produces("application/json")]
public class ReportViewsController(ReportViewService views) : ControllerBase
{
    /// <summary>The caller's saved views of the report (default first, then by name). 404 when the report is unknown, inactive or not assigned.</summary>
    [HttpGet(Name = "ListReportViews")]
    [Authorize(Policy = ReportPolicies.Run)]
    [ProducesResponseType<ReportViewListResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(int reportId, CancellationToken cancellationToken)
    {
        var result = await views.ListAsync(reportId, cancellationToken);
        return result.Problem is { } p
            ? ReportProblems.Create(this, p)
            : Ok(new ReportViewListResponse(result.Value!.Select(ToResponse).ToList(), ReportViewLayoutRules.MaxViewsPerReport));
    }

    /// <summary>Saves a view. 422 for a bad name or layout, 409 <c>VIEW_NAME_EXISTS</c> for a name already used, 409 <c>VIEW_LIMIT_REACHED</c> at 25 views.</summary>
    [HttpPost(Name = "CreateReportView")]
    [Authorize(Policy = ReportPolicies.Run)]
    [RequestSizeLimit(64 * 1024)]
    [ProducesResponseType<ReportViewResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create(int reportId, [FromBody] CreateReportViewRequest request, CancellationToken cancellationToken)
    {
        var result = await views.CreateAsync(reportId, request.Name, request.Layout, request.IsDefault, cancellationToken);
        return result.Problem is { } p ? ReportProblems.Create(this, p) : StatusCode(StatusCodes.Status201Created, ToResponse(result.Value!));
    }

    /// <summary>Renames a view and/or replaces its layout ("Save View" on an applied view). 404 for a view that is not the caller's.</summary>
    [HttpPut("{viewId:int}", Name = "UpdateReportView")]
    [Authorize(Policy = ReportPolicies.Run)]
    [RequestSizeLimit(64 * 1024)]
    [ProducesResponseType<ReportViewResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int reportId, int viewId, [FromBody] UpdateReportViewRequest request, CancellationToken cancellationToken)
    {
        var result = await views.UpdateAsync(reportId, viewId, request.Name, request.Layout, cancellationToken);
        return result.Problem is { } p ? ReportProblems.Create(this, p) : Ok(ToResponse(result.Value!));
    }

    /// <summary>Deletes a view. 204; 404 for a view that is not the caller's.</summary>
    [HttpDelete("{viewId:int}", Name = "DeleteReportView")]
    [Authorize(Policy = ReportPolicies.Run)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int reportId, int viewId, CancellationToken cancellationToken)
    {
        var result = await views.DeleteAsync(reportId, viewId, cancellationToken);
        return result.Problem is { } p ? ReportProblems.Create(this, p) : NoContent();
    }

    /// <summary>Makes the view the caller's default for this report (any earlier default is cleared). 404 for a view that is not the caller's.</summary>
    [HttpPost("{viewId:int}/default", Name = "SetDefaultReportView")]
    [Authorize(Policy = ReportPolicies.Run)]
    [ProducesResponseType<ReportViewResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetDefault(int reportId, int viewId, CancellationToken cancellationToken)
    {
        var result = await views.SetDefaultAsync(reportId, viewId, true, cancellationToken);
        return result.Problem is { } p ? ReportProblems.Create(this, p) : Ok(ToResponse(result.Value!));
    }

    /// <summary>Removes the default mark from the view (no view is applied automatically afterwards). 404 for a view that is not the caller's.</summary>
    [HttpDelete("{viewId:int}/default", Name = "ClearDefaultReportView")]
    [Authorize(Policy = ReportPolicies.Run)]
    [ProducesResponseType<ReportViewResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ClearDefault(int reportId, int viewId, CancellationToken cancellationToken)
    {
        var result = await views.SetDefaultAsync(reportId, viewId, false, cancellationToken);
        return result.Problem is { } p ? ReportProblems.Create(this, p) : Ok(ToResponse(result.Value!));
    }

    private static ReportViewResponse ToResponse(ReportViewResponseModel v) => new(v.ViewId, v.Name, v.IsDefault, v.Layout, v.CreatedAtUtc, v.ModifiedAtUtc, v.IgnoredColumns);
}
