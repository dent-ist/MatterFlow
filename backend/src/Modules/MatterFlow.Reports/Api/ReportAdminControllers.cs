using MatterFlow.Identity.Contracts;
using MatterFlow.Reports.Application;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Reports.Api;

/// <summary>Permission policies of the Reports endpoints (every action names one; the architecture tests enforce it).</summary>
internal static class ReportPolicies
{
    public const string Manage = "Perm:" + Permissions.Report.Manage;
    public const string Assign = "Perm:" + Permissions.Report.Assign;
    public const string Run = "Perm:" + Permissions.Report.Run;
}

/// <summary>The Reports health as shown on the admin Reports page.</summary>
/// <param name="Enabled">True when reports can run.</param>
/// <param name="State">Stable code: <c>Ready</c> or <c>NotConfigured</c> (more codes arrive with the startup probe).</param>
/// <param name="Message">Administrator wording for the state.</param>
public sealed record ReportsStatusResponse(bool Enabled, string State, string Message);

/// <summary>Report administration (<c>Report.Manage</c>). The authoring endpoints arrive with the admin API issues.</summary>
[ApiController]
[Route("api/v1/report-admin")]
[Produces("application/json")]
public class ReportAdminController(IReportsAvailability availability) : ControllerBase
{
    /// <summary>Whether reports can run and, if not, why (missing or unsafe report login, failed probe).</summary>
    [HttpGet("status", Name = "GetReportsStatus")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<ReportsStatusResponse>(StatusCodes.Status200OK, "application/json")]
    public ActionResult<ReportsStatusResponse> Status()
    {
        var s = availability.Current;
        return new ReportsStatusResponse(s.Enabled, s.State, s.Message);
    }
}
