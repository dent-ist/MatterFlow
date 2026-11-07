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
/// <param name="IsInstant">
/// For <c>dateTime</c> columns: true when the value is a point in time (the SQL type is <c>datetimeoffset</c>): it is sent in UTC with a trailing <c>Z</c>
/// (<c>2026-03-31T18:05:00Z</c>) and the client shows it in the person's time zone. False when the value is a wall-clock time with no zone
/// (<c>datetime</c>, <c>datetime2</c>, <c>smalldatetime</c>): it is sent as it is stored (<c>2026-03-31T14:05:00</c>) and shown unchanged. Always false for other types.
/// </param>
public sealed record ResultColumnResponse(string Name, string Type, bool IsInstant = false);

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

/// <summary>A report in the list of the person who may run it.</summary>
/// <param name="ReportId">Id to run (<c>POST /reports/{id}/runs</c>) and to read the definition.</param>
/// <param name="Description">The administrator's one-line description, or null.</param>
/// <param name="SortOrder">The administrator's order inside the category (the list is already in this order).</param>
/// <param name="ParameterCount">How many parameters the person is asked for (0 for a report that runs without a form).</param>
/// <param name="HasParameters">True when <paramref name="ParameterCount"/> is more than 0.</param>
/// <param name="ParameterLabels">The labels of those parameters, in order.</param>
/// <param name="LastRunAtUtc">When this person last ran the report successfully (UTC), null when never. Other people's runs never show.</param>
public sealed record RunnableReportListItemResponse(
    int ReportId,
    string Name,
    string? Description,
    int SortOrder,
    int ParameterCount,
    bool HasParameters,
    IReadOnlyList<string> ParameterLabels,
    DateTime? LastRunAtUtc);

/// <summary>A category with the reports the person may run in it (categories with nothing to run are left out).</summary>
public sealed record RunnableReportCategoryResponse(int CategoryId, string Name, int SortOrder, IReadOnlyList<RunnableReportListItemResponse> Reports);

/// <summary>The reports the person may run, grouped by category in the administrator's order. Never contains SQL.</summary>
/// <param name="TotalReports">Reports in all categories together.</param>
public sealed record RunnableReportListResponse(IReadOnlyList<RunnableReportCategoryResponse> Categories, int TotalReports);

/// <summary>A fixed choice of a single or multi choice parameter.</summary>
public sealed record RunnableOptionResponse(string Value, string Label);

/// <summary>
/// One input of the parameter form. Which members apply depends on <c>type</c>; the others are null, false or empty. There is no member for SQL or for a
/// choice query.
/// </summary>
/// <param name="Name">Upper-case key of the value in the run request (for <c>dateRange</c> the base name; the value is <c>{from,to}</c>).</param>
/// <param name="Type">number, date, text, single, multi, dateRange, yesNo or lookup.</param>
/// <param name="Label">What the form shows (the name when the administrator gave no label).</param>
/// <param name="HelpText">A muted line under the field, or null.</param>
/// <param name="Required">True when a run needs a value.</param>
/// <param name="Default">The default already resolved for this person and day (a date for <c>today</c>, the person's pod ids for <c>myPods</c>), in the form the run request takes; null when there is none.</param>
/// <param name="Multiple">True when the value is a list (multi choice, or a lookup that takes several).</param>
/// <param name="LookupKind">For lookup: matter, client, user, pod, role or taskType.</param>
/// <param name="ValueType">For single and multi: <c>text</c> or <c>int</c> (what the option values are).</param>
/// <param name="ChoicesSource">For single and multi: <c>fixed</c> (the options are in <c>options</c>) or <c>query</c> (ask <c>POST /reports/{id}/choices/{name}</c>).</param>
/// <param name="Options">The options of a fixed list; empty otherwise.</param>
/// <param name="Min">For number: lowest value, or null.</param>
/// <param name="Max">For number: highest value, or null.</param>
/// <param name="IntegerOnly">For number: a fraction is refused.</param>
/// <param name="MaxLength">For text: the longest accepted value.</param>
/// <param name="MaxSelected">For lists: the most selections the run accepts.</param>
public sealed record RunnableParameterResponse(
    string Name,
    string Type,
    string Label,
    string? HelpText,
    bool Required,
    JsonElement? Default,
    bool Multiple,
    string? LookupKind,
    string? ValueType,
    string? ChoicesSource,
    IReadOnlyList<RunnableOptionResponse> Options,
    decimal? Min,
    decimal? Max,
    bool IntegerOnly,
    int? MaxLength,
    int? MaxSelected);

/// <summary>The definition of a report for the person who may run it: everything the run page shows, and no SQL.</summary>
/// <param name="HelpText">The administrator's longer help text (markdown-lite), or null.</param>
/// <param name="VersionNo">The version a run would use.</param>
/// <param name="TimeoutSeconds">The time limit that applies to a run of this report.</param>
/// <param name="MaxRows">The row limit that applies to a run of this report.</param>
/// <param name="Parameters">The inputs of the form, in order; empty when the report runs without a form.</param>
public sealed record RunnableReportResponse(
    int ReportId,
    string Name,
    string? Description,
    string? HelpText,
    int CategoryId,
    string CategoryName,
    int VersionNo,
    int TimeoutSeconds,
    int MaxRows,
    IReadOnlyList<RunnableParameterResponse> Parameters);

/// <summary>Running reports (<c>Report.Run</c> plus an assignment of the report to one of the caller's roles).</summary>
[ApiController]
[Route("api/v1/reports")]
[Produces("application/json")]
public class ReportsController(ReportRunService runs, ReportResultStore results, ICurrentUser currentUser, ReportBrowseService browse, ReportExportService export) : ControllerBase
{
    /// <summary>
    /// The reports the caller may run: active reports with a current version that are assigned to one of the caller's roles (needs <c>Report.Run</c>), grouped
    /// by category in the administrator's order. One call, no paging. Nothing about reports the caller may not run is revealed, and the body never contains SQL.
    /// </summary>
    [HttpGet(Name = "ListMyReports")]
    [Authorize(Policy = ReportPolicies.Run)]
    [ProducesResponseType<RunnableReportListResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var result = await browse.ListAsync(cancellationToken);
        if (result.Problem is { } problem)
            return ReportProblems.Create(this, new RunProblem(problem.Status, problem.Code, problem.Message));

        var categories = result.Value!
            .Select(c => new RunnableReportCategoryResponse(
                c.CategoryId,
                c.Name,
                c.SortOrder,
                c.Reports.Select(r => new RunnableReportListItemResponse(r.ReportId, r.Name, r.Description, r.SortOrder, r.ParameterCount, r.ParameterCount > 0, r.ParameterLabels, r.LastRunAtUtc)).ToList()))
            .ToList();
        return Ok(new RunnableReportListResponse(categories, categories.Sum(c => c.Reports.Count)));
    }

    /// <summary>
    /// The definition of a report the caller may run, for the run page: name, description, help text, category, version number, the limits and the
    /// parameters (type, label, required, resolved default, fixed options or where to ask for them, the lookup kind) in the shape the form needs. Never
    /// SQL, a choice query or a hash. 404 for an unknown, inactive or unassigned report, with the same body for all three.
    /// </summary>
    [HttpGet("{id:int}", Name = "GetMyReport")]
    [Authorize(Policy = ReportPolicies.Run)]
    [ProducesResponseType<RunnableReportResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int id, CancellationToken cancellationToken)
    {
        var result = await browse.GetAsync(id, cancellationToken);
        if (result.Problem is { } problem)
            return ReportProblems.Create(this, new RunProblem(problem.Status, problem.Code, problem.Message));

        var r = result.Value!;
        return Ok(new RunnableReportResponse(
            r.ReportId,
            r.Name,
            r.Description,
            r.HelpText,
            r.CategoryId,
            r.CategoryName,
            r.VersionNo,
            r.TimeoutSeconds,
            r.MaxRows,
            r.Parameters.Select(p => new RunnableParameterResponse(
                p.Name,
                p.Type,
                p.Label,
                p.HelpText,
                p.Required,
                p.Default,
                p.Multiple,
                p.LookupKind,
                p.ValueType,
                p.ChoicesSource,
                p.Options.Select(o => new RunnableOptionResponse(o.Value, o.Label)).ToList(),
                p.Min,
                p.Max,
                p.IntegerOnly,
                p.MaxLength,
                p.MaxSelected)).ToList()));
    }

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
        return Ok(new RunReportResponse(r.RunId, r.Columns.Select(c => new ResultColumnResponse(c.Name, ColumnTypeName(c.Type), c.Instant)).ToList(), r.RowCount, r.Truncated, r.DurationMs, r.MaxRows));
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
    /// A page of a cached result, filtered and sorted on the server. <c>sort</c> is <c>col:asc,col2:desc</c> (at most 3); a column is written by name or by its zero-based position as <c>#n</c> (<c>#1:desc</c>), which a client uses when a column name contains a comma; <c>filter</c> a JSON array of
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
                table.Columns.Select(c => new ResultColumnResponse(c.Name, ColumnTypeName(c.Type), c.Instant)).ToList(),
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

    /// <summary>
    /// Downloads the caller's live result as CSV: the rows the grid shows for the same <c>sort</c> and <c>filter</c> (all of them, not one page), the
    /// <c>columns</c> given (repeat the parameter, in file order; none means all), UTF-8 with a byte order mark, comma, CRLF, ISO dates, invariant numbers,
    /// formula-safe text cells. Streamed, never cached, no cookie link: the call carries the person's normal credentials. Writes a run-log row of kind
    /// Export and a <c>REPORT_EXPORT</c> audit event. 404 for an unknown id, another person's result or a report the caller may no longer run, 410
    /// <c>RESULT_EXPIRED</c> once the cache dropped the result, 400 for an unreadable sort, filter or column.
    /// </summary>
    [HttpGet("runs/{runId:guid}/export.csv", Name = "ExportReportRows")]
    [Authorize(Policy = ReportPolicies.Run)]
    [ProducesResponseType<string>(StatusCodes.Status200OK, "text/csv")]
    public async Task<IActionResult> ExportCsv(Guid runId, [FromQuery] string? sort = null, [FromQuery] string? filter = null, [FromQuery] string[]? columns = null, CancellationToken cancellationToken = default)
    {
        var lookup = Lookup(runId, out var stored);
        if (lookup is not null)
            return lookup;

        var prepared = await export.PrepareAsync(stored!, sort, filter, columns, cancellationToken);
        if (prepared.Problem is { } problem)
            return ReportProblems.Create(this, problem);

        var plan = prepared.Plan!;
        Response.ContentType = ReportCsvWriter.ContentType;
        Response.Headers.CacheControl = "no-store";
        Response.Headers.Pragma = "no-cache";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers.ContentDisposition = new System.Net.Mime.ContentDisposition { DispositionType = "attachment", FileName = plan.FileName }.ToString();
        Response.Headers["X-Export-Rows"] = plan.RowCount.ToString(System.Globalization.CultureInfo.InvariantCulture);
        Response.Headers["X-Export-Truncated"] = plan.Stored.Truncated ? "true" : "false";
        await export.StreamAsync(plan, Response.Body, cancellationToken);
        return new EmptyResult();
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
