using System.Text.Json;
using MatterFlow.Reports.Application;
using MatterFlow.Reports.Domain;
using MatterFlow.Reports.Domain.Parameters;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Reports.Api;

/// <summary>A report category.</summary>
/// <param name="RowVersion">Opaque concurrency token (base64); send it as <c>If-Match</c> when saving.</param>
public sealed record ReportCategoryResponse(int CategoryId, string Name, int SortOrder, bool IsActive, int ReportCount, string RowVersion);

/// <summary>Create or change a category. Categories are never deleted, only deactivated.</summary>
public sealed record SaveCategoryRequest(string? Name, int SortOrder, bool IsActive = true);

/// <summary>A row of the admin Reports list.</summary>
/// <param name="VersionNo">Number of the current version.</param>
/// <param name="Previewed">True when the current version passed a preview (so it can be activated).</param>
/// <param name="RoleCount">Roles the report is assigned to.</param>
/// <param name="LastRunAtUtc">When a person last ran it (previews do not count).</param>
public sealed record ReportListItemResponse(
    int ReportId,
    string Name,
    int CategoryId,
    string CategoryName,
    int SortOrder,
    string? Description,
    bool IsActive,
    int? VersionNo,
    bool Previewed,
    int RoleCount,
    DateTime? LastRunAtUtc,
    DateTime? ModifiedAtUtc,
    string RowVersion);

public sealed record ReportListResponse(IReadOnlyList<ReportListItemResponse> Items, int Total);

/// <summary>A report as the editor loads it: details, the current version's SQL and parameter definitions.</summary>
/// <param name="Parameters">The parameter definitions of the current version (a JSON array, see the spec section 5).</param>
/// <param name="CanActivate">True when the current version passed a preview.</param>
/// <param name="RowVersion">Concurrency token (also the <c>ETag</c> header).</param>
public sealed record ReportDetailResponse(
    int ReportId,
    string Name,
    int CategoryId,
    string CategoryName,
    string? Description,
    string? HelpText,
    int SortOrder,
    bool IsActive,
    int? TimeoutSeconds,
    int? MaxRows,
    int? VersionId,
    int? VersionNo,
    string? Sql,
    JsonElement Parameters,
    string? ChangeNote,
    bool CanActivate,
    int RoleCount,
    DateTime CreatedAtUtc,
    string? CreatedByName,
    DateTime? ModifiedAtUtc,
    string? ModifiedByName,
    string RowVersion);

/// <summary>A new report: its details and the first version. It starts inactive.</summary>
public sealed record CreateReportRequest(string? Name, int CategoryId, string? Description, string? HelpText, int SortOrder, int? TimeoutSeconds, int? MaxRows, string? Sql, JsonElement? Parameters, string? ChangeNote);

public sealed record CreatedReportResponse(int ReportId, int VersionId, int VersionNo, string RowVersion);

/// <summary>
/// Save from the editor: the details always, the SQL and parameters when sent. Identical SQL and parameters write no version. The row version comes in
/// the <c>If-Match</c> header.
/// </summary>
public sealed record UpdateReportRequest(string? Name, int CategoryId, string? Description, string? HelpText, int SortOrder, int? TimeoutSeconds, int? MaxRows, string? Sql, JsonElement? Parameters, string? ChangeNote, bool KeepActive, Dictionary<string, JsonElement>? SampleValues);

public sealed record ReportVersionResponse(int VersionId, int VersionNo, DateTime CreatedAtUtc, int? CreatedByUserId, string? CreatedByName, string? ChangeNote, bool IsCurrent, string Hash);

public sealed record ReportVersionDetailResponse(ReportVersionResponse Version, string Sql, JsonElement Parameters);

/// <param name="Kind">same, added or removed.</param>
public sealed record DiffLineResponse(string Kind, string Text, int? OldLine, int? NewLine);

public sealed record ReportVersionComparisonResponse(
    int FromVersionNo,
    int ToVersionNo,
    IReadOnlyList<DiffLineResponse> Sql,
    IReadOnlyList<string> ParametersAdded,
    IReadOnlyList<string> ParametersRemoved,
    IReadOnlyList<string> ParametersChanged);

/// <summary>Report administration (<c>Report.Manage</c>): list, create, save with a row version, versions, compare, restore, categories. There is no delete.</summary>
[ApiController]
[Route("api/v1/report-admin")]
[Produces("application/json")]
public class ReportDefinitionsController(ReportAdminService admin) : ControllerBase
{
    private const int MaxBodyBytes = 512 * 1024;

    // ---- Categories ----

    /// <summary>All categories (including inactive ones) in display order, with the number of reports in each.</summary>
    [HttpGet("categories", Name = "ListReportCategories")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<IReadOnlyList<ReportCategoryResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<ReportCategoryResponse>>> Categories(CancellationToken cancellationToken) =>
        Ok((await admin.ListCategoriesAsync(cancellationToken)).Select(MapCategory).ToList());

    /// <summary>Creates a category. 409 <c>DUPLICATE_NAME</c> when the name is taken.</summary>
    [HttpPost("categories", Name = "CreateReportCategory")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<ReportCategoryResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> CreateCategory([FromBody] SaveCategoryRequest request, CancellationToken cancellationToken)
    {
        var result = await admin.CreateCategoryAsync(request.Name, request.SortOrder, cancellationToken);
        return result.Problem is { } p ? Problem(p) : StatusCode(StatusCodes.Status201Created, MapCategory(result.Value!));
    }

    /// <summary>Renames, reorders, activates or deactivates a category. Needs <c>If-Match</c>; 409 <c>CONCURRENCY_CONFLICT</c> when it changed meanwhile.</summary>
    [HttpPut("categories/{categoryId:int}", Name = "UpdateReportCategory")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<ReportCategoryResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> UpdateCategory(int categoryId, [FromBody] SaveCategoryRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, CancellationToken cancellationToken)
    {
        if (!IfMatch.TryRead(ifMatch, out var rowVersion))
            return IfMatch.Problem(this, ifMatch);
        var result = await admin.UpdateCategoryAsync(categoryId, request.Name, request.SortOrder, request.IsActive, rowVersion, cancellationToken);
        return result.Problem is { } p ? Problem(p) : Ok(MapCategory(result.Value!));
    }

    // ---- Reports ----

    /// <summary>The report list including inactive reports, in category and report order. Filter by <c>status</c> (active or inactive), <c>categoryId</c> and a <c>search</c> text (name, description, category).</summary>
    [HttpGet("reports", Name = "ListAdminReports")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<ReportListResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<ReportListResponse>> List([FromQuery] string? status, [FromQuery] int? categoryId, [FromQuery] string? search, CancellationToken cancellationToken)
    {
        var rows = await admin.ListAsync(new ReportListFilter(status, categoryId, search), cancellationToken);
        return new ReportListResponse(rows.Select(r => new ReportListItemResponse(r.ReportId, r.Name, r.CategoryId, r.CategoryName, r.SortOrder, r.Description, r.IsActive, r.VersionNo, r.Previewed, r.RoleCount, r.LastRunAtUtc, r.ModifiedAtUtc, Convert.ToBase64String(r.RowVersion))).ToList(), rows.Count);
    }

    /// <summary>Creates a report with its first version. It starts inactive: preview it, then activate it. 409 <c>DUPLICATE_NAME</c>; 422 with per-field errors.</summary>
    [HttpPost("reports", Name = "CreateReport")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [RequestSizeLimit(MaxBodyBytes)]
    [ProducesResponseType<CreatedReportResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateReportRequest request, CancellationToken cancellationToken)
    {
        var details = new ReportDetails(request.Name ?? "", request.CategoryId, request.Description, request.HelpText, request.SortOrder, request.TimeoutSeconds, request.MaxRows);
        var result = await admin.CreateAsync(new CreateReportCommand(details, request.Sql, request.Parameters?.GetRawText(), request.ChangeNote), cancellationToken);
        if (result.Problem is { } p)
            return Problem(p);
        var c = result.Value!;
        return StatusCode(StatusCodes.Status201Created, new CreatedReportResponse(c.ReportId, c.VersionId, c.VersionNo, Convert.ToBase64String(c.RowVersion)));
    }

    /// <summary>One report with its current SQL and parameter definitions. The <c>ETag</c> header is the row version for <c>If-Match</c>.</summary>
    [HttpGet("reports/{id:int}", Name = "GetAdminReport")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<ReportDetailResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int id, CancellationToken cancellationToken)
    {
        var result = await admin.GetAsync(id, cancellationToken);
        if (result.Problem is { } p)
            return Problem(p);
        var r = result.Value!;
        var rowVersion = Convert.ToBase64String(r.RowVersion);
        Response.Headers.ETag = "\"" + rowVersion + "\"";
        return Ok(new ReportDetailResponse(
            r.ReportId, r.Name, r.CategoryId, r.CategoryName, r.Description, r.HelpText, r.SortOrder, r.IsActive, r.TimeoutSeconds, r.MaxRows, r.VersionId, r.VersionNo,
            r.SqlText, ParseArray(r.ParametersJson), r.ChangeNote, r.VersionId is not null && r.LastPreviewOkVersionId == r.VersionId, r.RoleCount,
            r.CreatedAtUtc, r.CreatedByName, r.ModifiedAtUtc, r.ModifiedByName, rowVersion));
    }

    /// <summary>
    /// Saves the editor: details always, and a new version when the SQL or parameters changed (identical text writes nothing). Needs <c>If-Match</c> with
    /// the row version; 409 <c>CONCURRENCY_CONFLICT</c> when someone else saved first, 409 <c>DUPLICATE_NAME</c>, 422 with per-field errors. An active report
    /// stays active only when <c>keepActive</c> is set and the new text passes a preview in this same call; otherwise it is deactivated.
    /// </summary>
    [HttpPut("reports/{id:int}", Name = "UpdateReport")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [RequestSizeLimit(MaxBodyBytes)]
    [ProducesResponseType<SaveVersionResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateReportRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, CancellationToken cancellationToken)
    {
        if (!IfMatch.TryRead(ifMatch, out var rowVersion))
            return IfMatch.Problem(this, ifMatch);
        var details = new ReportDetails(request.Name ?? "", request.CategoryId, request.Description, request.HelpText, request.SortOrder, request.TimeoutSeconds, request.MaxRows);
        var result = await admin.SaveAsync(
            new SaveReportCommand(id, rowVersion, details, request.Sql, request.Parameters?.GetRawText() ?? (request.Sql is null ? null : "[]"), request.ChangeNote, request.KeepActive, request.SampleValues ?? []),
            cancellationToken);
        return SaveResult(result);
    }

    /// <summary>All versions of a report, newest first. Versions are append-only.</summary>
    [HttpGet("reports/{id:int}/versions", Name = "ListReportVersions")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<IReadOnlyList<ReportVersionResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Versions(int id, CancellationToken cancellationToken)
    {
        var result = await admin.ListVersionsAsync(id, cancellationToken);
        return result.Problem is { } p ? Problem(p) : Ok(result.Value!.Select(MapVersion).ToList());
    }

    /// <summary>One version with its SQL and parameter definitions.</summary>
    [HttpGet("reports/{id:int}/versions/{versionNo:int}", Name = "GetReportVersion")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<ReportVersionDetailResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Version(int id, int versionNo, CancellationToken cancellationToken)
    {
        var result = await admin.GetVersionAsync(id, versionNo, cancellationToken);
        return result.Problem is { } p ? Problem(p) : Ok(new ReportVersionDetailResponse(MapVersion(result.Value!.Version), result.Value.SqlText, ParseArray(result.Value.ParametersJson)));
    }

    /// <summary>Compares a version with another (<c>against</c>, default the one before it): the SQL as a line diff, the parameters by name.</summary>
    [HttpGet("reports/{id:int}/versions/{versionNo:int}/compare", Name = "CompareReportVersions")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<ReportVersionComparisonResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Compare(int id, int versionNo, [FromQuery] int? against, CancellationToken cancellationToken)
    {
        var result = await admin.CompareAsync(id, versionNo, against, cancellationToken);
        if (result.Problem is { } p)
            return Problem(p);
        var c = result.Value!;
        return Ok(new ReportVersionComparisonResponse(
            c.FromVersionNo,
            c.ToVersionNo,
            c.Sql.Select(l => new DiffLineResponse(l.Kind switch { DiffKind.Added => "added", DiffKind.Removed => "removed", _ => "same" }, l.Text, l.OldLine, l.NewLine)).ToList(),
            c.ParametersAdded,
            c.ParametersRemoved,
            c.ParametersChanged));
    }

    /// <summary>
    /// Restores an old version as a <b>new</b> version (history is never rewritten). The report is deactivated until the restored version passes a preview.
    /// Needs <c>If-Match</c>; 409 <c>ALREADY_CURRENT</c> for the current version.
    /// </summary>
    [HttpPost("reports/{id:int}/versions/{versionNo:int}/restore", Name = "RestoreReportVersion")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<SaveVersionResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Restore(int id, int versionNo, [FromHeader(Name = "If-Match")] string? ifMatch, CancellationToken cancellationToken)
    {
        if (!IfMatch.TryRead(ifMatch, out var rowVersion))
            return IfMatch.Problem(this, ifMatch);
        return SaveResult(await admin.RestoreAsync(id, versionNo, rowVersion, cancellationToken));
    }

    internal IActionResult SaveResult(SaveVersionResult result)
    {
        if (result.Problem is { } problem)
            return Problem(problem);
        var v = result.Version!;
        return Ok(new SaveVersionResponse(v.VersionId, v.VersionNo, v.IsActive, result.Deactivated, result.Unchanged, Convert.ToBase64String(v.RowVersion), result.Preview is null ? null : ReportAdminController.MapPreview(result.Preview)));
    }

    private IActionResult Problem(ReportStateProblem p) => ReportProblems.Create(this, new RunProblem(p.Status, p.Code, p.Message, p.Errors));

    private static ReportCategoryResponse MapCategory(CategoryRow c) => new(c.CategoryId, c.Name, c.SortOrder, c.IsActive, c.ReportCount, Convert.ToBase64String(c.RowVersion));

    private static ReportVersionResponse MapVersion(VersionRow v) => new(v.VersionId, v.VersionNo, v.CreatedAtUtc, v.CreatedByUserId, v.CreatedByName, v.ChangeNote, v.IsCurrent, v.Hash);

    internal static JsonElement ParseArray(string? json)
    {
        try
        {
            return JsonSerializer.Deserialize<JsonElement>(string.IsNullOrWhiteSpace(json) ? "[]" : json);
        }
        catch (JsonException)
        {
            return JsonSerializer.Deserialize<JsonElement>("[]");
        }
    }
}

/// <summary>Reads the row version from <c>If-Match</c> (the <c>ETag</c> of a read: the base64 value, quoted or not).</summary>
internal static class IfMatch
{
    public static bool TryRead(string? header, out byte[] rowVersion)
    {
        rowVersion = [];
        if (string.IsNullOrWhiteSpace(header))
            return false;
        var value = header.Trim();
        if (value.StartsWith("W/", StringComparison.Ordinal))
            value = value[2..];
        value = value.Trim('"');
        try
        {
            rowVersion = Convert.FromBase64String(value);
            return rowVersion.Length > 0;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    /// <summary>428 when the header is missing, 400 when it is not a row version.</summary>
    public static IActionResult Problem(ControllerBase controller, string? header) =>
        string.IsNullOrWhiteSpace(header)
            ? ReportProblems.Create(controller, new RunProblem(428, "IF_MATCH_REQUIRED", "Send the row version you last read in the If-Match header."))
            : ReportProblems.Create(controller, new RunProblem(400, "IF_MATCH_INVALID", "The If-Match header is not a row version."));
}
