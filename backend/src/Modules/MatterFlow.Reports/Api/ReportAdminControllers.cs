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

/// <summary>What the startup probe found out about the report login. Never contains the password or SQL Server's own error text.</summary>
/// <param name="LoginName">The SQL login the reports run under.</param>
/// <param name="WritesDenied">True when the login cannot write, execute or change the schema.</param>
/// <param name="AuditTablesDenied">True when the login cannot read the audit, identity and Reports tables.</param>
/// <param name="ReadableTables">How many tables the login can read.</param>
/// <param name="CompatibilityLevel">Database compatibility level (reports need 130 or higher).</param>
/// <param name="CheckedAtUtc">When the probe last ran.</param>
public sealed record ReportLoginDetailsResponse(string LoginName, bool WritesDenied, bool AuditTablesDenied, int ReadableTables, int CompatibilityLevel, DateTime CheckedAtUtc);

/// <summary>The Reports health as shown on the admin Reports page.</summary>
/// <param name="Enabled">True when reports can run.</param>
/// <param name="State">Stable code: Ready, NotConfigured, SharedWithApplication, Checking, LoginFailed, RoleMissing, TooPrivileged or CompatibilityTooLow.</param>
/// <param name="Message">Administrator wording for the state.</param>
/// <param name="Login">Present once the login could be probed.</param>
public sealed record ReportsStatusResponse(bool Enabled, string State, string Message, ReportLoginDetailsResponse? Login);

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
    public ActionResult<ReportsStatusResponse> Status() => Map(availability.Current);

    /// <summary>Probes the report login again (after the owner created or fixed it) and returns the new state.</summary>
    [HttpPost("status/check", Name = "CheckReportsStatus")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<ReportsStatusResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<ReportsStatusResponse>> Check(CancellationToken cancellationToken) => Map(await availability.CheckAsync(cancellationToken));

    private static ReportsStatusResponse Map(ReportsStatus s) =>
        new(s.Enabled, s.State, s.Message, s.Details is { } d ? new(d.LoginName, d.WritesDenied, d.AuditTablesDenied, d.ReadableTables, d.CompatibilityLevel, d.CheckedAtUtc) : null);
}
