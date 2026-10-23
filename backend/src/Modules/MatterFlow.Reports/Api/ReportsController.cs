using System.Diagnostics;
using System.Text.Json;
using MatterFlow.Reports.Application;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Reports.Api;

/// <summary>The parameter values of a run, by parameter name.</summary>
/// <param name="Parameters">Values as JSON: numbers, <c>yyyy-MM-dd</c> dates, text, booleans, arrays for lists, <c>{from,to}</c> for a date range. Built-in names are refused.</param>
public sealed record RunReportRequest(Dictionary<string, JsonElement>? Parameters);

/// <summary>A column of a result.</summary>
/// <param name="Name">Unique, non-empty name.</param>
/// <param name="Type">text, integer, decimal, boolean, date or dateTime.</param>
public sealed record ResultColumnResponse(string Name, string Type);

/// <summary>The result of a run: its id and shape. The rows are fetched page by page with that id.</summary>
public sealed record RunReportResponse(Guid RunId, IReadOnlyList<ResultColumnResponse> Columns, int RowCount, bool Truncated, int DurationMs, int MaxRows);

/// <summary>Running reports (<c>Report.Run</c> plus an assignment of the report to one of the caller's roles).</summary>
[ApiController]
[Route("api/v1/reports")]
[Produces("application/json")]
public class ReportsController(ReportRunService runs) : ControllerBase
{
    /// <summary>
    /// Runs a report the caller's role is assigned to, on the read-only report login, with real SQL parameters. 200 with the result's id and
    /// columns; 404 when the report is unknown, inactive or not assigned; 408 on the time limit; 409 <c>REPORT_ALREADY_RUNNING</c> (one report per
    /// person); 422 with per-parameter errors; 429 <c>REPORT_BUSY</c> / <c>REPORT_RATE_LIMITED</c>; 503 when reports are off. Errors never contain SQL text.
    /// </summary>
    [HttpPost("{id:int}/runs", Name = "RunReport")]
    [Authorize(Policy = ReportPolicies.Run)]
    [RequestSizeLimit(256 * 1024)]
    [ProducesResponseType<RunReportResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Run(int id, [FromBody] RunReportRequest request, CancellationToken cancellationToken)
    {
        var result = await runs.RunAsync(id, request.Parameters ?? new Dictionary<string, JsonElement>(), cancellationToken);
        if (result.Problem is { } problem)
            return ReportProblems.Create(this, problem);

        var r = result.Response!;
        return Ok(new RunReportResponse(r.RunId, r.Columns.Select(c => new ResultColumnResponse(c.Name, ColumnTypeName(c.Type))).ToList(), r.RowCount, r.Truncated, r.DurationMs, r.MaxRows));
    }

    /// <summary>Cancels the report the caller is running right now, if any. 204 either way.</summary>
    [HttpDelete("runs/current", Name = "CancelMyReportRun")]
    [Authorize(Policy = ReportPolicies.Run)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public IActionResult CancelCurrent()
    {
        runs.CancelMine();
        return NoContent();
    }

    internal static string ColumnTypeName(ReportColumnType type) => type switch
    {
        ReportColumnType.Integer => "integer",
        ReportColumnType.Decimal => "decimal",
        ReportColumnType.Boolean => "boolean",
        ReportColumnType.Date => "date",
        ReportColumnType.DateTime => "dateTime",
        _ => "text",
    };
}

/// <summary>RFC 9457 problem responses for the Reports endpoints (modules cannot call the host's helper), with the stable <c>code</c>, per-parameter <c>errors</c> and a short <c>reference</c>.</summary>
internal static class ReportProblems
{
    public static ObjectResult Create(ControllerBase controller, RunProblem p)
    {
        var problem = new ProblemDetails
        {
            Type = "urn:matterflow:error:" + p.Code.ToLowerInvariant().Replace('_', '-'),
            Title = Humanize(p.Code),
            Status = p.Status,
            Detail = p.Message,
        };
        problem.Extensions["code"] = p.Code;
        problem.Extensions["traceId"] = Activity.Current?.Id ?? controller.HttpContext.TraceIdentifier;
        if (p.Errors is { Count: > 0 })
            problem.Extensions["errors"] = p.Errors;
        if (p.Reference is not null)
            problem.Extensions["reference"] = p.Reference;
        return new ObjectResult(problem) { StatusCode = p.Status, ContentTypes = { "application/problem+json" } };
    }

    private static string Humanize(string code)
    {
        var lower = code.ToLowerInvariant().Replace('_', ' ');
        return lower.Length == 0 ? lower : char.ToUpperInvariant(lower[0]) + lower[1..];
    }
}
