using System.Diagnostics;
using System.Text.Json;
using MatterFlow.Reports.Application;
using MatterFlow.Reports.Application.Results;
using MatterFlow.SharedKernel.Identity;
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

/// <summary>One page of a cached result after the server applied the filters and the sort.</summary>
/// <param name="Columns">The columns, in order.</param>
/// <param name="Rows">The cells of the page; numbers as numbers, dates as <c>yyyy-MM-dd</c> text, null for empty.</param>
/// <param name="TotalRows">Rows in the whole result.</param>
/// <param name="FilteredRows">Rows left after the filters (what the pager counts).</param>
/// <param name="Page">The page returned (1-based, clamped to the last page).</param>
/// <param name="PageSize">Rows per page (at most 250).</param>
/// <param name="Truncated">True when the result was cut off at the row cap.</param>
public sealed record ReportRowsResponse(
    IReadOnlyList<ResultColumnResponse> Columns,
    IReadOnlyList<IReadOnlyList<object?>> Rows,
    int TotalRows,
    int FilteredRows,
    int Page,
    int PageSize,
    bool Truncated);

/// <summary>Running reports (<c>Report.Run</c> plus an assignment of the report to one of the caller's roles).</summary>
[ApiController]
[Route("api/v1/reports")]
[Produces("application/json")]
public class ReportsController(ReportRunService runs, ReportResultStore results, ICurrentUser currentUser) : ControllerBase
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

    /// <summary>
    /// A page of a cached result, filtered and sorted on the server. <c>sort</c> is <c>col:asc,col2:desc</c> (at most 3), <c>filter</c> a JSON array of
    /// <c>{column, op, value, value2}</c>. Nulls sort last ascending, text case-insensitively. 404 for an unknown id or another person's result, 410
    /// <c>RESULT_EXPIRED</c> once the cache dropped it (run the report again), 400 for an unreadable sort or filter.
    /// </summary>
    [HttpGet("runs/{runId:guid}/rows", Name = "GetReportRows")]
    [Authorize(Policy = ReportPolicies.Run)]
    [ProducesResponseType<ReportRowsResponse>(StatusCodes.Status200OK, "application/json")]
    public IActionResult Rows(Guid runId, [FromQuery] int page = 1, [FromQuery] int pageSize = 50, [FromQuery] string? sort = null, [FromQuery] string? filter = null)
    {
        var lookup = Lookup(runId, out var stored);
        if (lookup is not null)
            return lookup;

        try
        {
            var table = stored!.Table;
            var result = ResultQuery.Page(table, ResultQuery.ParseFilters(filter), ResultQuery.ParseSort(sort, table), page, pageSize);
            return Ok(new ReportRowsResponse(
                table.Columns.Select(c => new ResultColumnResponse(c.Name, ColumnTypeName(c.Type))).ToList(),
                result.Rows,
                result.TotalRows,
                result.FilteredRows,
                result.Page,
                result.PageSize,
                stored.Truncated));
        }
        catch (ResultQueryException ex)
        {
            return ReportProblems.Create(this, new RunProblem(400, "RESULT_QUERY_INVALID", ex.Message));
        }
    }

    /// <summary>Drops the caller's cached result. 204 whether or not it still existed.</summary>
    [HttpDelete("runs/{runId:guid}", Name = "DropReportResult")]
    [Authorize(Policy = ReportPolicies.Run)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public IActionResult Drop(Guid runId)
    {
        if (currentUser.UserId is { } id)
            results.Drop(id, runId);
        return NoContent();
    }

    private IActionResult? Lookup(Guid runId, out StoredResult? stored)
    {
        stored = null;
        if (currentUser.UserId is not { } userId)
            return ReportProblems.Create(this, new RunProblem(401, "UNAUTHENTICATED", "Sign in to view reports."));
        var (status, result) = results.Get(userId, runId);
        stored = result;
        return status switch
        {
            ResultLookup.Found => null,
            ResultLookup.Expired => ReportProblems.Create(this, new RunProblem(410, "RESULT_EXPIRED", "This result has expired. Run the report again.")),
            _ => ReportProblems.Create(this, new RunProblem(404, "NOT_FOUND", "This result does not exist.")),
        };
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
