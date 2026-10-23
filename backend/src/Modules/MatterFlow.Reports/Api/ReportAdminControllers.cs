using System.Text.Json;
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

/// <summary>A parameter the editor has declared as a list (multi choice or multi lookup), so the analysis reads <c>IN :NAME</c> correctly.</summary>
/// <param name="Name">Placeholder name (case-insensitive).</param>
/// <param name="ValueType"><c>int</c> or <c>text</c> (the cast of the engine's sub-select).</param>
public sealed record AnalyzeListParameter(string Name, string ValueType);

/// <summary>The SQL to analyse (the unsaved editor text).</summary>
/// <param name="Sql">The report query.</param>
/// <param name="Lists">Parameters declared as lists; optional.</param>
public sealed record AnalyzeRequest(string? Sql, IReadOnlyList<AnalyzeListParameter>? Lists = null);

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

/// <summary>The verdict of the one-SELECT-only check (defence in depth; the report login's permissions are the real control).</summary>
/// <param name="IsValid">True when the query is exactly one SELECT without forbidden constructs.</param>
/// <param name="Errors">Every reason with a stable code and the position in the text as typed.</param>
/// <param name="SqlHash">SHA-256 of the exact text (hex), stored with the version.</param>
public sealed record SqlValidationResponse(bool IsValid, IReadOnlyList<SqlIssueResponse> Errors, string SqlHash);

/// <summary>What the editor shows next to the query: placeholders with positions and problems. Nothing is executed.</summary>
/// <param name="Placeholders">Distinct placeholders in order of first appearance.</param>
/// <param name="Occurrences">Every token with its position.</param>
/// <param name="Issues">Problems with the text.</param>
/// <param name="DateRangeCandidates">Names X for which both X_FROM and X_TO are used (proposed as one date range).</param>
/// <param name="Validation">The one-SELECT-only verdict.</param>
public sealed record AnalyzeResponse(
    IReadOnlyList<DetectedPlaceholderResponse> Placeholders,
    IReadOnlyList<PlaceholderOccurrenceResponse> Occurrences,
    IReadOnlyList<SqlIssueResponse> Issues,
    IReadOnlyList<string> DateRangeCandidates,
    SqlValidationResponse Validation);

/// <summary>The author's unsaved editor state to preview.</summary>
/// <param name="Sql">The query text; null previews the saved version.</param>
/// <param name="Parameters">The parameter definitions as in the version snapshot (a JSON array); null uses the saved ones.</param>
/// <param name="SampleValues">Values the author typed, by parameter name. Required parameters without a value or default get a sample (0, today, "sample", the first option).</param>
public sealed record PreviewRequest(string? Sql, JsonElement? Parameters, Dictionary<string, JsonElement>? SampleValues);

/// <summary>A parameter value that was refused.</summary>
public sealed record ParameterErrorResponse(string Name, string Code, string Message);

/// <summary>The result of a preview: the first rows, or why not. Shown to administrators only (it may contain SQL Server's own message).</summary>
/// <param name="Success">True when the query ran.</param>
/// <param name="Status">Succeeded, Truncated, Failed, TimedOut, Cancelled or Rejected.</param>
/// <param name="Columns">Columns of the result.</param>
/// <param name="Rows">At most 20 rows.</param>
/// <param name="RowCount">Rows counted, up to the cap.</param>
/// <param name="ExceedsCap">True when the full result would be cut off at the row cap.</param>
/// <param name="DurationMs">Run time.</param>
/// <param name="ValidationErrors">Why the text was refused.</param>
/// <param name="ParameterErrors">Why the sample values were refused.</param>
/// <param name="SqlError">SQL Server's message when the query failed.</param>
/// <param name="SqlErrorLine">Line of the error in the query, when known.</param>
/// <param name="CountsForActivation">True when this exact saved version passed, so Activate is now possible.</param>
/// <param name="RowVersion">The report's row version after the preview marked it (base64), when it did.</param>
public sealed record PreviewResponse(
    bool Success,
    string Status,
    IReadOnlyList<ResultColumnResponse> Columns,
    IReadOnlyList<IReadOnlyList<object?>> Rows,
    int RowCount,
    bool ExceedsCap,
    int DurationMs,
    IReadOnlyList<SqlIssueResponse> ValidationErrors,
    IReadOnlyList<ParameterErrorResponse> ParameterErrors,
    string? SqlError,
    int? SqlErrorLine,
    bool CountsForActivation,
    string? RowVersion);

/// <summary>A new version of a report.</summary>
/// <param name="Sql">The query text.</param>
/// <param name="Parameters">The parameter definitions (JSON array, as in the version snapshot).</param>
/// <param name="ChangeNote">Optional note (300 characters) shown in the history.</param>
/// <param name="KeepActive">Preview the text first and keep an active report active when it passes.</param>
/// <param name="SampleValues">Sample values for that preview.</param>
public sealed record SaveVersionRequest(string? Sql, JsonElement? Parameters, string? ChangeNote, bool KeepActive, Dictionary<string, JsonElement>? SampleValues);

/// <summary>What saving did.</summary>
/// <param name="VersionId">Id of the current version after the save.</param>
/// <param name="VersionNo">Its number.</param>
/// <param name="IsActive">Whether the report is active now.</param>
/// <param name="Deactivated">True when an active report was deactivated because the new text was not previewed.</param>
/// <param name="Unchanged">True when nothing changed, so no version was written.</param>
/// <param name="RowVersion">Row version of the report (base64).</param>
/// <param name="Preview">The preview that ran as part of the save, if any.</param>
public sealed record SaveVersionResponse(int VersionId, int VersionNo, bool IsActive, bool Deactivated, bool Unchanged, string RowVersion, PreviewResponse? Preview);

/// <summary>One run in the run log.</summary>
/// <param name="RunId">Log id (also the paging cursor).</param>
/// <param name="Status">Running, Succeeded, Failed, Cancelled, TimedOut, Truncated or Rejected.</param>
/// <param name="Kind">Run, Preview, Export or ChoiceQuery.</param>
/// <param name="Parameters">The values as bound, as <c>NAME=value</c> (long values shortened; built-in values are not listed).</param>
public sealed record ReportRunLogItemResponse(
    long RunId,
    int ReportId,
    string ReportName,
    int VersionNo,
    int UserId,
    string UserName,
    DateTime StartedAtUtc,
    DateTime? FinishedAtUtc,
    string Status,
    string Kind,
    int? RowCount,
    bool Truncated,
    int? DurationMs,
    string? ErrorCode,
    IReadOnlyList<string> Parameters);

/// <summary>A page of the run log, newest first. <paramref name="NextBefore"/> is the cursor for the next (older) page.</summary>
public sealed record ReportRunLogPageResponse(IReadOnlyList<ReportRunLogItemResponse> Items, long? NextBefore);

/// <summary>Whether a report is active after an activate or deactivate.</summary>
public sealed record ReportStateResponse(int ReportId, bool IsActive, int? CurrentVersionId, string? RowVersion);

/// <summary>Report administration (<c>Report.Manage</c>). The authoring endpoints arrive with the admin API issues.</summary>
[ApiController]
[Route("api/v1/report-admin")]
[Produces("application/json")]
public class ReportAdminController(IReportsAvailability availability, ReportAuthoringService authoring, IReportRunLogReader runLog) : ControllerBase
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
            return new AnalyzeResponse([], [], [tooLong], [], new SqlValidationResponse(false, [tooLong], Convert.ToHexString(SqlValidator.Hash(text))));
        }

        var lists = new Dictionary<string, Domain.Parameters.ListKind>(StringComparer.Ordinal) { [BuiltInParameters.CurrentPodIds] = Domain.Parameters.ListKind.Int };
        foreach (var l in (request.Lists ?? []).Take(200).Where(l => !string.IsNullOrWhiteSpace(l.Name)))
            lists[l.Name.Trim().ToUpperInvariant()] = string.Equals(l.ValueType, "int", StringComparison.OrdinalIgnoreCase) ? Domain.Parameters.ListKind.Int : Domain.Parameters.ListKind.Text;
        var compiled = ReportSqlCompiler.Compile(text, lists);
        var scan = compiled.Scan;
        var verdict = SqlValidator.Validate(text, scan, compiled.Rewritten);
        return new AnalyzeResponse(
            scan.Placeholders.Select(p => new DetectedPlaceholderResponse(p.Name, p.DisplayName, p.Position, p.Line, p.Column, p.Occurrences, p.IsBuiltIn)).ToList(),
            scan.Occurrences.Select(o => new PlaceholderOccurrenceResponse(o.Name, o.Start, o.Length, o.Line, o.Column)).ToList(),
            scan.Issues.Select(i => new SqlIssueResponse(i.Code, i.Message, i.Position, i.Line, i.Column)).ToList(),
            scan.DateRangeCandidates,
            new SqlValidationResponse(
                verdict.IsValid,
                verdict.Errors.Select(e => new SqlIssueResponse(e.Code, e.Message, e.Position, e.Line, e.Column)).ToList(),
                Convert.ToHexString(verdict.Hash)));
    }

    /// <summary>
    /// Runs the unsaved editor text with sample values on the read-only login: first 20 rows, column names and types, duration, whether the full result
    /// would hit the row cap; 15 s limit; logged as a preview and counted as the author's one running report. A successful preview of exactly the saved
    /// text and parameters is what allows activation. Validation and SQL errors are returned in full (administrators only).
    /// </summary>
    [HttpPost("reports/{id:int}/preview", Name = "PreviewReport")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [RequestSizeLimit(MaxAnalyzeBytes)]
    [ProducesResponseType<PreviewResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Preview(int id, [FromBody] PreviewRequest request, CancellationToken cancellationToken)
    {
        var result = await authoring.PreviewAsync(id, request.Sql, request.Parameters?.GetRawText(), request.SampleValues ?? [], cancellationToken);
        if (result.Problem is { } problem)
            return ReportProblems.Create(this, new RunProblem(problem.Status, problem.Code, problem.Message));

        return Ok(MapPreview(result));
    }

    /// <summary>Activates a report so the roles it is assigned to can run it. 409 <c>PREVIEW_REQUIRED</c> unless its current version passed a preview.</summary>
    [HttpPost("reports/{id:int}/activate", Name = "ActivateReport")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<ReportStateResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Activate(int id, CancellationToken cancellationToken) => State(id, await authoring.ActivateAsync(id, cancellationToken));

    /// <summary>Deactivates a report: it disappears from the users' lists and cannot run; history, versions and assignments stay.</summary>
    [HttpPost("reports/{id:int}/deactivate", Name = "DeactivateReport")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<ReportStateResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Deactivate(int id, CancellationToken cancellationToken) => State(id, await authoring.DeactivateAsync(id, cancellationToken));

    /// <summary>The run log (read-only, newest first): who ran which version of which report with which values, how it ended and how long it took. Filter by report, status, kind or person; page with <c>before</c>.</summary>
    [HttpGet("runs", Name = "ListReportRuns")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<ReportRunLogPageResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<ReportRunLogPageResponse>> Runs(
        [FromQuery] int? reportId, [FromQuery] string? status, [FromQuery] string? kind, [FromQuery] int? userId, [FromQuery] long? before, [FromQuery] int pageSize = 50, CancellationToken cancellationToken = default) =>
        MapLog(await runLog.ListAsync(new RunLogQuery(reportId, status, kind, userId, before, pageSize), cancellationToken));

    /// <summary>The run log of one report.</summary>
    [HttpGet("reports/{id:int}/runs", Name = "ListRunsOfReport")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<ReportRunLogPageResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<ReportRunLogPageResponse>> RunsOfReport(
        int id, [FromQuery] string? status, [FromQuery] string? kind, [FromQuery] int? userId, [FromQuery] long? before, [FromQuery] int pageSize = 50, CancellationToken cancellationToken = default) =>
        MapLog(await runLog.ListAsync(new RunLogQuery(id, status, kind, userId, before, pageSize), cancellationToken));

    private static ReportRunLogPageResponse MapLog(RunLogPage page) => new(
        page.Items.Select(i => new ReportRunLogItemResponse(i.RunId, i.ReportId, i.ReportName, i.VersionNo, i.UserId, i.UserName, i.StartedAtUtc, i.FinishedAtUtc, i.Status, i.Kind, i.RowCount, i.Truncated, i.DurationMs, i.ErrorCode, i.Parameters)).ToList(),
        page.NextBefore);

    private static PreviewResponse MapPreview(PreviewResult result) => new(
        result.Success,
        result.Status,
        result.Columns.Select(c => new ResultColumnResponse(c.Name, ReportsController.ColumnTypeName(c.Type))).ToList(),
        result.Rows,
        result.RowCount,
        result.ExceedsCap,
        result.DurationMs,
        result.ValidationErrors.Select(e => new SqlIssueResponse(e.Code, e.Message, e.Position, e.Line, e.Column)).ToList(),
        result.ParameterErrors.Select(e => new ParameterErrorResponse(e.Name, e.Code, e.Message)).ToList(),
        result.SqlError,
        result.SqlErrorLine,
        result.CountsForActivation,
        result.RowVersion is null ? null : Convert.ToBase64String(result.RowVersion));

    /// <summary>
    /// Saves a new version of a report (the SQL and its parameter definitions). Identical text and parameters write nothing. A new version of an active
    /// report stays active only when <c>keepActive</c> is set and the text passed a preview in this same call; otherwise the report is deactivated until
    /// it is previewed again ("Saved as version n. Preview it to activate.").
    /// </summary>
    [HttpPost("reports/{id:int}/versions", Name = "SaveReportVersion")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [RequestSizeLimit(MaxAnalyzeBytes)]
    [ProducesResponseType<SaveVersionResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SaveVersion(int id, [FromBody] SaveVersionRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Sql))
            return ReportProblems.Create(this, new RunProblem(400, "SQL_REQUIRED", "Enter a query."));
        if (request.Sql.Length > SqlScanner.MaxQueryLength)
            return ReportProblems.Create(this, new RunProblem(400, SqlValidationCodes.TextTooLong, "The query is too long."));

        var result = await authoring.SaveVersionAsync(id, request.Sql, request.Parameters?.GetRawText() ?? "[]", request.ChangeNote, request.KeepActive, request.SampleValues ?? [], cancellationToken);
        if (result.Problem is { } problem)
            return ReportProblems.Create(this, new RunProblem(problem.Status, problem.Code, problem.Message));

        var v = result.Version!;
        return Ok(new SaveVersionResponse(v.VersionId, v.VersionNo, v.IsActive, result.Deactivated, result.Unchanged, Convert.ToBase64String(v.RowVersion), result.Preview is null ? null : MapPreview(result.Preview)));
    }

    private IActionResult State(int id, ReportStateResult result) =>
        result.Problem is { } problem
            ? ReportProblems.Create(this, new RunProblem(problem.Status, problem.Code, problem.Message))
            : Ok(new ReportStateResponse(id, result.IsActive, result.CurrentVersionId, result.RowVersion is null ? null : Convert.ToBase64String(result.RowVersion)));

    private const int MaxAnalyzeBytes = 256 * 1024;

    private static ReportsStatusResponse Map(ReportsStatus s) =>
        new(s.Enabled, s.State, s.Message, s.Details is { } d ? new(d.LoginName, d.WritesDenied, d.AuditTablesDenied, d.ReadableTables, d.CompatibilityLevel, d.CheckedAtUtc) : null);
}
