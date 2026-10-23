using MatterFlow.Reports.Application;
using MatterFlow.Reports.Domain.Parameters;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Reports.Api;

/// <summary>A column the report login can read.</summary>
public sealed record SchemaColumnResponse(string Name, string Type, bool IsNullable, bool IsPrimaryKey);

/// <summary>A table or view the report login can read.</summary>
public sealed record SchemaTableResponse(string Schema, string Name, string FullName, bool IsView, IReadOnlyList<SchemaColumnResponse> Columns);

/// <summary>A page of the schema browser: tables (with all their columns) that match the search by table or column name.</summary>
public sealed record SchemaPageResponse(IReadOnlyList<SchemaTableResponse> Tables, int Total, int Page, int PageSize);

/// <summary>The schema browser (<c>Report.Manage</c>): metadata of the tables and views the report login may read. Denied tables never appear.</summary>
[ApiController]
[Route("api/v1/report-admin/schema")]
[Produces("application/json")]
public class ReportSchemaController(ReportSchemaService schema) : ControllerBase
{
    /// <summary>Readable tables and views with columns (name, type, nullability, primary key). <c>search</c> matches table or column names; paged (50 per page, at most 200); cached for 60 seconds. 503 while Reports are off.</summary>
    [HttpGet(Name = "SearchReportSchema")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<SchemaPageResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Search([FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int pageSize = ReportSchemaService.DefaultPageSize, CancellationToken cancellationToken = default)
    {
        var result = await schema.SearchAsync(search, page, pageSize, cancellationToken);
        if (result is null)
            return ReportProblems.Create(this, new RunProblem(503, "REPORTS_UNAVAILABLE", "Reports are not available right now."));
        return Ok(new SchemaPageResponse(result.Tables.Select(Map).ToList(), result.Total, result.Page, result.PageSize));
    }

    /// <summary>One table or view by <c>name</c> or <c>schema.name</c>. 404 when it does not exist or the login cannot read it (the same answer).</summary>
    [HttpGet("{table}", Name = "GetReportSchemaTable")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [ProducesResponseType<SchemaTableResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Table(string table, CancellationToken cancellationToken)
    {
        var found = await schema.FindAsync(table, cancellationToken);
        return found is null ? ReportProblems.Create(this, new RunProblem(404, "NOT_FOUND", "This table does not exist or cannot be read by reports.")) : Ok(Map(found));
    }

    private static SchemaTableResponse Map(SchemaTable t) => new(t.Schema, t.Name, t.FullName, t.IsView, t.Columns.Select(c => new SchemaColumnResponse(c.Name, c.Type, c.IsNullable, c.IsPrimaryKey)).ToList());
}

/// <param name="Value">What is bound (text; a whole number as text for an integer list).</param>
public sealed record ChoiceOptionResponse(string Value, string Label);

/// <param name="Truncated">True when the list was cut at 1,000 entries.</param>
public sealed record ChoiceListResponse(IReadOnlyList<ChoiceOptionResponse> Options, bool Truncated);

/// <summary>A choice query typed in the editor, to test.</summary>
/// <param name="Sql">The SELECT with the columns Value and Label.</param>
/// <param name="ValueType">text or int.</param>
public sealed record ChoiceTestRequest(string? Sql, string? ValueType);

/// <param name="Success">True when the query returned a usable list.</param>
/// <param name="Options">The first 100 entries.</param>
/// <param name="Total">All entries (up to 1,000).</param>
/// <param name="ErrorCode">CHOICE_QUERY_REJECTED, CHOICE_QUERY_FAILED, CHOICE_COLUMNS or REPORTS_UNAVAILABLE.</param>
/// <param name="Error">The reason in full (administrators only).</param>
public sealed record ChoiceTestResponse(bool Success, IReadOnlyList<ChoiceOptionResponse> Options, int Total, bool Truncated, int DurationMs, string? ErrorCode, string? Error);

/// <summary>Choice lists of report parameters.</summary>
[ApiController]
[Route("api/v1")]
[Produces("application/json")]
public class ReportChoicesController(ReportChoiceService choices) : ControllerBase
{
    /// <summary>
    /// The choices of a single or multi choice parameter of a report the caller may run: the fixed list, or the result of the report's choice SELECT
    /// (Value and Label, at most 1,000 rows, 10 s, cached 5 minutes per person). A lookup parameter (matter, client, user, pod...) has no list: the
    /// pickers of those pages and their own permissions serve it (400 <c>NO_CHOICE_LIST</c>). The value is checked against this list again on every run.
    /// </summary>
    [HttpPost("reports/{id:int}/choices/{parameter}", Name = "GetReportChoices")]
    [Authorize(Policy = ReportPolicies.Run)]
    [ProducesResponseType<ChoiceListResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ForRun(int id, string parameter, CancellationToken cancellationToken)
    {
        var result = await choices.GetForUserAsync(id, parameter, cancellationToken);
        if (result.Problem is { } p)
            return ReportProblems.Create(this, new RunProblem(p.Status, p.Code, p.Message));
        return Ok(new ChoiceListResponse(result.Value!.Options.Select(o => new ChoiceOptionResponse(o.Value, o.Label)).ToList(), result.Value.Truncated));
    }

    /// <summary>Runs an unsaved choice SELECT through the same validator, executor and login as a report and shows the first entries or the reason it failed. Logged as a choice query; never cached.</summary>
    [HttpPost("report-admin/reports/{id:int}/choices/test", Name = "TestReportChoiceQuery")]
    [Authorize(Policy = ReportPolicies.Manage)]
    [RequestSizeLimit(256 * 1024)]
    [ProducesResponseType<ChoiceTestResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Test(int id, [FromBody] ChoiceTestRequest request, CancellationToken cancellationToken)
    {
        var type = string.Equals(request.ValueType, "int", StringComparison.OrdinalIgnoreCase) ? ChoiceValueType.Int : ChoiceValueType.Text;
        var result = await choices.TestAsync(id, request.Sql, type, cancellationToken);
        if (result.Problem is { } p)
            return ReportProblems.Create(this, new RunProblem(p.Status, p.Code, p.Message));
        var list = result.Value!;
        return Ok(new ChoiceTestResponse(list.IsOk, list.Options.Take(100).Select(o => new ChoiceOptionResponse(o.Value, o.Label)).ToList(), list.Options.Count, list.Truncated, list.DurationMs, list.ErrorCode, list.Detail));
    }
}

/// <summary>A role as the assignment screens show it.</summary>
public sealed record RoleAssignmentResponse(int RoleId, string Name, string? Description, bool IsActive, bool IsSystemAdmin, int MemberCount, bool Assigned);

/// <summary>A report as the assignment screens show it: name, category and description only. Never SQL.</summary>
public sealed record ReportAssignmentResponse(int ReportId, string Name, int CategoryId, string CategoryName, int CategorySortOrder, int SortOrder, string? Description, bool IsActive, bool Assigned);

public sealed record NamedIdResponse(int Id, string Name);

/// <summary>Replace the roles of a report. Send every role that should hold it (empty removes all).</summary>
public sealed record SetReportRolesRequest(List<int>? RoleIds);

/// <summary>Replace the reports of a role. Send every report the role should hold (empty removes all).</summary>
public sealed record SetRoleReportsRequest(List<int>? ReportIds);

/// <param name="Added">Roles (or reports) that now hold it.</param>
/// <param name="Removed">Roles (or reports) that no longer hold it.</param>
/// <param name="AssignedCount">How many the report (or role) has after the change.</param>
/// <param name="OwnerName">Name of the report (or role) that changed.</param>
public sealed record AssignmentDiffResponse(IReadOnlyList<NamedIdResponse> Added, IReadOnlyList<NamedIdResponse> Removed, int AssignedCount, string OwnerName);

public sealed record AssignmentCellResponse(int RoleId, int ReportId);

public sealed record AssignmentMatrixResponse(IReadOnlyList<NamedIdResponse> Roles, IReadOnlyList<ReportAssignmentResponse> Reports, IReadOnlyList<AssignmentCellResponse> Cells);

/// <summary>Assigning reports to roles, from both sides (<c>Report.Assign</c>). Responses carry names, categories and descriptions only, never SQL, so a person who may assign but not manage cannot read a query.</summary>
[ApiController]
[Route("api/v1/report-admin")]
[Produces("application/json")]
public class ReportAssignmentController(ReportAdminService admin) : ControllerBase
{
    /// <summary>Every role with whether it holds the report and how many people it has.</summary>
    [HttpGet("reports/{id:int}/roles", Name = "GetRolesOfReport")]
    [Authorize(Policy = ReportPolicies.Assign)]
    [ProducesResponseType<IReadOnlyList<RoleAssignmentResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> RolesOfReport(int id, CancellationToken cancellationToken)
    {
        var result = await admin.GetReportRolesAsync(id, cancellationToken);
        return result.Problem is { } p
            ? Problem(p)
            : Ok(result.Value!.Select(r => new RoleAssignmentResponse(r.RoleId, r.Name, r.Description, r.IsActive, r.IsSystemAdmin, r.MemberCount, r.Assigned)).ToList());
    }

    /// <summary>Replaces the set of roles that hold the report and answers with the difference (also written to the audit trail). 422 <c>ROLE_NOT_FOUND</c> for an unknown role.</summary>
    [HttpPut("reports/{id:int}/roles", Name = "SetRolesOfReport")]
    [Authorize(Policy = ReportPolicies.Assign)]
    [ProducesResponseType<AssignmentDiffResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetRolesOfReport(int id, [FromBody] SetReportRolesRequest request, CancellationToken cancellationToken)
    {
        var result = await admin.SetReportRolesAsync(id, request.RoleIds, cancellationToken);
        return result.Problem is { } p ? Problem(p) : Ok(Map(result.Value!));
    }

    /// <summary>Every report (inactive ones flagged) with whether the role holds it. Name, category and description only.</summary>
    [HttpGet("roles/{roleId:int}/reports", Name = "GetReportsOfRole")]
    [Authorize(Policy = ReportPolicies.Assign)]
    [ProducesResponseType<IReadOnlyList<ReportAssignmentResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ReportsOfRole(int roleId, CancellationToken cancellationToken)
    {
        var result = await admin.GetRoleReportsAsync(roleId, cancellationToken);
        return result.Problem is { } p ? Problem(p) : Ok(result.Value!.Select(MapReport).ToList());
    }

    /// <summary>Replaces the set of reports the role holds and answers with the difference (one audit event per affected report). 422 <c>REPORT_NOT_FOUND</c> for an unknown report.</summary>
    [HttpPut("roles/{roleId:int}/reports", Name = "SetReportsOfRole")]
    [Authorize(Policy = ReportPolicies.Assign)]
    [ProducesResponseType<AssignmentDiffResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetReportsOfRole(int roleId, [FromBody] SetRoleReportsRequest request, CancellationToken cancellationToken)
    {
        var result = await admin.SetRoleReportsAsync(roleId, request.ReportIds, cancellationToken);
        return result.Problem is { } p ? Problem(p) : Ok(Map(result.Value!));
    }

    /// <summary>Active roles by reports, for a read-only overview. Names only.</summary>
    [HttpGet("assignment-matrix", Name = "GetReportAssignmentMatrix")]
    [Authorize(Policy = ReportPolicies.Assign)]
    [ProducesResponseType<AssignmentMatrixResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<AssignmentMatrixResponse>> Matrix(CancellationToken cancellationToken)
    {
        var m = await admin.GetMatrixAsync(cancellationToken);
        return new AssignmentMatrixResponse(m.Roles.Select(r => new NamedIdResponse(r.Id, r.Name)).ToList(), m.Reports.Select(MapReport).ToList(), m.Cells.Select(c => new AssignmentCellResponse(c.RoleId, c.ReportId)).ToList());
    }

    private IActionResult Problem(ReportStateProblem p) => ReportProblems.Create(this, new RunProblem(p.Status, p.Code, p.Message, p.Errors));

    private static AssignmentDiffResponse Map(AssignmentDiff d) =>
        new(d.Added.Select(n => new NamedIdResponse(n.Id, n.Name)).ToList(), d.Removed.Select(n => new NamedIdResponse(n.Id, n.Name)).ToList(), d.AssignedCount, d.OwnerName);

    private static ReportAssignmentResponse MapReport(ReportAssignmentRow r) => new(r.ReportId, r.Name, r.CategoryId, r.CategoryName, r.CategorySortOrder, r.SortOrder, r.Description, r.IsActive, r.Assigned);
}
