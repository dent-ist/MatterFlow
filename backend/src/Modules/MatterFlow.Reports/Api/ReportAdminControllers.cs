using MatterFlow.Identity.Contracts;
using MatterFlow.Reports.Application;
using MatterFlow.Reports.Domain;
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

/// <summary>The SQL to analyse (the unsaved editor text).</summary>
/// <param name="Sql">The report query.</param>
public sealed record AnalyzeRequest(string? Sql);

/// <summary>A distinct <c>:NAME</c> placeholder found in the SQL.</summary>
/// <param name="Name">Upper-cased name without the colon.</param>
/// <param name="DisplayName">The first spelling.</param>
/// <param name="Position">0-based index of the colon in the text.</param>
/// <param name="Line">1-based line of the first occurrence.</param>
/// <param name="Column">1-based column of the first occurrence.</param>
/// <param name="Occurrences">How often it appears.</param>
/// <param name="IsBuiltIn">True when the server supplies the value (no input is shown).</param>
public sealed record DetectedPlaceholderResponse(string Name, string DisplayName, int Position, int Line, int Column, int Occurrences, bool IsBuiltIn);

/// <summary>One occurrence of a placeholder (the editor highlights these).</summary>
public sealed record PlaceholderOccurrenceResponse(string Name, int Start, int Length, int Line, int Column);

/// <summary>A problem with the query text.</summary>
/// <param name="Code">Stable code, for example <c>AT_SIGN_NOT_ALLOWED</c>.</param>
/// <param name="Message">Wording for the author.</param>
/// <param name="Position">0-based index in the text.</param>
/// <param name="Line">1-based line.</param>
/// <param name="Column">1-based column.</param>
public sealed record SqlIssueResponse(string Code, string Message, int Position, int Line, int Column);

/// <summary>What the editor shows next to the query: placeholders with positions and problems. Nothing is executed.</summary>
/// <param name="Placeholders">Distinct placeholders in order of first appearance.</param>
/// <param name="Occurrences">Every token with its position.</param>
/// <param name="Issues">Problems with the text.</param>
/// <param name="DateRangeCandidates">Names X for which both X_FROM and X_TO are used (proposed as one date range).</param>
public sealed record AnalyzeResponse(
    IReadOnlyList<DetectedPlaceholderResponse> Placeholders,
    IReadOnlyList<PlaceholderOccurrenceResponse> Occurrences,
    IReadOnlyList<SqlIssueResponse> Issues,
    IReadOnlyList<string> DateRangeCandidates);

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

    /// <summary>
    /// Reads the unsaved query text and returns the detected <c>:NAME</c> placeholders with their positions, the built-in matches and any problem
    /// (unterminated string, <c>@</c>). Nothing is executed and nothing is stored. The body is limited to 256 kB.
    /// </summary>
    [HttpPost("analyze", Name = "AnalyzeReportSql")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [RequestSizeLimit(MaxAnalyzeBytes)]
    [ProducesResponseType<AnalyzeResponse>(StatusCodes.Status200OK, "application/json")]
    public ActionResult<AnalyzeResponse> Analyze([FromBody] AnalyzeRequest request)
    {
        var text = request.Sql ?? "";
        if (text.Length > SqlScanner.MaxQueryLength)
        {
            var tooLong = new SqlIssueResponse(ScanIssueCodes.TextTooLong, $"The query is longer than {SqlScanner.MaxQueryLength:N0} characters.", SqlScanner.MaxQueryLength, 1, 1);
            return new AnalyzeResponse([], [], [tooLong], []);
        }

        var scan = SqlScanner.Scan(text);
        return new AnalyzeResponse(
            scan.Placeholders.Select(p => new DetectedPlaceholderResponse(p.Name, p.DisplayName, p.Position, p.Line, p.Column, p.Occurrences, p.IsBuiltIn)).ToList(),
            scan.Occurrences.Select(o => new PlaceholderOccurrenceResponse(o.Name, o.Start, o.Length, o.Line, o.Column)).ToList(),
            scan.Issues.Select(i => new SqlIssueResponse(i.Code, i.Message, i.Position, i.Line, i.Column)).ToList(),
            scan.DateRangeCandidates);
    }

    private const int MaxAnalyzeBytes = 256 * 1024;

    private static ReportsStatusResponse Map(ReportsStatus s) =>
        new(s.Enabled, s.State, s.Message, s.Details is { } d ? new(d.LoginName, d.WritesDenied, d.AuditTablesDenied, d.ReadableTables, d.CompatibilityLevel, d.CheckedAtUtc) : null);
}
