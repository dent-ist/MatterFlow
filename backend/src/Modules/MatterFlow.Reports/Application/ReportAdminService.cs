using System.Text.Json;
using MatterFlow.Reports.Domain;
using MatterFlow.Reports.Domain.Parameters;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using Microsoft.Extensions.Options;

namespace MatterFlow.Reports.Application;

/// <summary>A value or the problem (HTTP status, stable code, message and optional per-field errors) that the endpoint answers.</summary>
public sealed record AdminResult<T>(T? Value, ReportStateProblem? Problem)
{
    public static AdminResult<T> Ok(T value) => new(value, null);

    public static AdminResult<T> Fail(int status, string code, string message, IReadOnlyDictionary<string, IReadOnlyList<FieldError>>? errors = null) => new(default, new ReportStateProblem(status, code, message, errors));

    public static AdminResult<T> From(ReportStateProblem problem) => new(default, problem);
}

/// <summary>Input of a create. <see cref="Sql"/> is the first version.</summary>
public sealed record CreateReportCommand(ReportDetails Details, string? Sql, string? ParametersJson, string? ChangeNote);

/// <summary>One comparison of two versions of a report: the SQL as a line diff and the parameters by name.</summary>
public sealed record VersionComparison(
    int FromVersionNo,
    int ToVersionNo,
    IReadOnlyList<DiffLine> Sql,
    IReadOnlyList<string> ParametersAdded,
    IReadOnlyList<string> ParametersRemoved,
    IReadOnlyList<string> ParametersChanged);

/// <summary>
/// The admin side of Reports (<c>Report.Manage</c>, assignment <c>Report.Assign</c>): categories, the report list, create, save with a row version,
/// versions, compare and restore, and the two-way assignment of reports to roles. Nothing is ever deleted; a report is only deactivated.
/// </summary>
public sealed class ReportAdminService(IReportAdminStore store, ReportAuthoringService authoring, ICurrentUser user, IOptions<ReportsOptions> options)
{
    private readonly ReportsOptions _options = options.Value;

    public const int MaxNameLength = 150;
    public const int MaxDescriptionLength = 1000;
    public const int MaxHelpTextLength = 20_000;
    public const int MaxChangeNoteLength = 300;
    public const int MaxCategoryNameLength = 100;

    // ---- Categories ----

    public Task<IReadOnlyList<CategoryRow>> ListCategoriesAsync(CancellationToken cancellationToken) => store.ListCategoriesAsync(cancellationToken);

    public async Task<AdminResult<CategoryRow>> CreateCategoryAsync(string? name, int sortOrder, CancellationToken cancellationToken)
    {
        var trimmed = (name ?? "").Trim();
        if (CategoryErrors(trimmed, sortOrder) is { } errors)
            return Invalid<CategoryRow>("Check the category.", errors);
        var result = await store.CreateCategoryAsync(trimmed, sortOrder, user.UserId, cancellationToken);
        return result.Status switch
        {
            StoreStatus.Ok => AdminResult<CategoryRow>.Ok(result.Value!),
            StoreStatus.DuplicateName => AdminResult<CategoryRow>.Fail(409, "DUPLICATE_NAME", "Another category already has this name."),
            _ => AdminResult<CategoryRow>.Fail(500, ErrorCodes.InternalError, "The category could not be saved."),
        };
    }

    public async Task<AdminResult<CategoryRow>> UpdateCategoryAsync(int categoryId, string? name, int sortOrder, bool isActive, byte[] rowVersion, CancellationToken cancellationToken)
    {
        var trimmed = (name ?? "").Trim();
        if (CategoryErrors(trimmed, sortOrder) is { } errors)
            return Invalid<CategoryRow>("Check the category.", errors);
        var result = await store.UpdateCategoryAsync(categoryId, trimmed, sortOrder, isActive, rowVersion, user.UserId, cancellationToken);
        return result.Status switch
        {
            StoreStatus.Ok => AdminResult<CategoryRow>.Ok(result.Value!),
            StoreStatus.NotFound => AdminResult<CategoryRow>.Fail(404, ErrorCodes.NotFound, "This category does not exist."),
            StoreStatus.Conflict => AdminResult<CategoryRow>.Fail(409, ErrorCodes.ConcurrencyConflict, "The category was changed by someone else. Reload it and try again."),
            StoreStatus.DuplicateName => AdminResult<CategoryRow>.Fail(409, "DUPLICATE_NAME", "Another category already has this name."),
            _ => AdminResult<CategoryRow>.Fail(500, ErrorCodes.InternalError, "The category could not be saved."),
        };
    }

    private static Dictionary<string, IReadOnlyList<FieldError>>? CategoryErrors(string name, int sortOrder)
    {
        var errors = new Dictionary<string, IReadOnlyList<FieldError>>();
        if (name.Length == 0)
            errors["name"] = [new("REQUIRED", "Enter a name.")];
        else if (name.Length > MaxCategoryNameLength)
            errors["name"] = [new("TOO_LONG", $"The name can have at most {MaxCategoryNameLength} characters.")];
        if (sortOrder is < 0 or > 100_000)
            errors["sortOrder"] = [new("OUT_OF_RANGE", "The order must be between 0 and 100000.")];
        return errors.Count == 0 ? null : errors;
    }

    // ---- Reports ----

    public Task<IReadOnlyList<ReportListRow>> ListAsync(ReportListFilter filter, CancellationToken cancellationToken) => store.ListReportsAsync(filter, cancellationToken);

    public async Task<AdminResult<ReportDetailRow>> GetAsync(int reportId, CancellationToken cancellationToken)
    {
        var row = await store.GetReportAsync(reportId, cancellationToken);
        return row is null ? NotFound<ReportDetailRow>() : AdminResult<ReportDetailRow>.Ok(row);
    }

    public async Task<AdminResult<CreatedReport>> CreateAsync(CreateReportCommand command, CancellationToken cancellationToken)
    {
        var errors = DetailsErrors(command.Details) ?? new Dictionary<string, IReadOnlyList<FieldError>>();
        if (string.IsNullOrWhiteSpace(command.Sql))
            errors["sql"] = [new("REQUIRED", "Enter a query.")];
        else if (command.Sql.Length > SqlScanner.MaxQueryLength)
            errors["sql"] = [new(SqlValidationCodes.TextTooLong, $"The query is longer than {SqlScanner.MaxQueryLength:N0} characters.")];
        if (command.ChangeNote is { Length: > MaxChangeNoteLength })
            errors["changeNote"] = [new("TOO_LONG", $"The note can have at most {MaxChangeNoteLength} characters.")];
        if (errors.Count > 0)
            return Invalid<CreatedReport>("Check the report.", errors);

        var parameters = ReportAuthoringService.NormalizeParameters(command.ParametersJson ?? "[]", out var problem);
        if (problem is not null)
            return AdminResult<CreatedReport>.From(problem);

        var details = Clean(command.Details);
        var created = await store.CreateReportAsync(new NewReport(details, command.Sql!, SqlValidator.Hash(command.Sql!), parameters, Blank(command.ChangeNote), user.UserId), cancellationToken);
        return created.Status switch
        {
            StoreStatus.Ok => AdminResult<CreatedReport>.Ok(created.Value!),
            StoreStatus.DuplicateName => AdminResult<CreatedReport>.Fail(409, "DUPLICATE_NAME", "Another report already has this name."),
            StoreStatus.CategoryInvalid => AdminResult<CreatedReport>.Fail(422, "CATEGORY_INVALID", "Choose an active category."),
            _ => AdminResult<CreatedReport>.Fail(500, ErrorCodes.InternalError, "The report could not be saved."),
        };
    }

    /// <summary>Saves details and/or a new version in one step (see <see cref="ReportAuthoringService.SaveAsync"/>).</summary>
    public async Task<SaveVersionResult> SaveAsync(SaveReportCommand command, CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, IReadOnlyList<FieldError>>();
        if (command.Details is { } details && DetailsErrors(details) is { } detailErrors)
        {
            foreach (var (key, value) in detailErrors)
                errors[key] = value;
        }

        if (command.Sql is not null && command.Sql.Length > SqlScanner.MaxQueryLength)
            errors["sql"] = [new(SqlValidationCodes.TextTooLong, $"The query is longer than {SqlScanner.MaxQueryLength:N0} characters.")];
        if (command.Sql is not null && string.IsNullOrWhiteSpace(command.Sql))
            errors["sql"] = [new("REQUIRED", "Enter a query.")];
        if (command.ChangeNote is { Length: > MaxChangeNoteLength })
            errors["changeNote"] = [new("TOO_LONG", $"The note can have at most {MaxChangeNoteLength} characters.")];
        if (errors.Count > 0)
            return new SaveVersionResult(null, false, false, null, new ReportStateProblem(422, "REPORT_DEFINITION_INVALID", "Check the report.", errors));

        return await authoring.SaveAsync(
            command with { Details = command.Details is null ? null : Clean(command.Details), ChangeNote = Blank(command.ChangeNote) },
            cancellationToken);
    }

    // ---- Versions ----

    public async Task<AdminResult<IReadOnlyList<VersionRow>>> ListVersionsAsync(int reportId, CancellationToken cancellationToken)
    {
        var rows = await store.ListVersionsAsync(reportId, cancellationToken);
        return rows is null ? NotFound<IReadOnlyList<VersionRow>>() : AdminResult<IReadOnlyList<VersionRow>>.Ok(rows);
    }

    public async Task<AdminResult<VersionDetail>> GetVersionAsync(int reportId, int versionNo, CancellationToken cancellationToken)
    {
        var detail = await store.GetVersionAsync(reportId, versionNo, cancellationToken);
        return detail is null ? NotFound<VersionDetail>() : AdminResult<VersionDetail>.Ok(detail);
    }

    /// <summary>Compares version <paramref name="versionNo"/> with <paramref name="againstVersionNo"/> (default: the one before it).</summary>
    public async Task<AdminResult<VersionComparison>> CompareAsync(int reportId, int versionNo, int? againstVersionNo, CancellationToken cancellationToken)
    {
        var to = await store.GetVersionAsync(reportId, versionNo, cancellationToken);
        if (to is null)
            return NotFound<VersionComparison>();
        var fromNo = againstVersionNo ?? versionNo - 1;
        var from = fromNo >= 1 ? await store.GetVersionAsync(reportId, fromNo, cancellationToken) : null;
        if (againstVersionNo is not null && from is null)
            return NotFound<VersionComparison>();

        var before = Parameters(from?.ParametersJson);
        var after = Parameters(to.ParametersJson);
        var added = after.Keys.Except(before.Keys).Order(StringComparer.Ordinal).ToList();
        var removed = before.Keys.Except(after.Keys).Order(StringComparer.Ordinal).ToList();
        var changed = after.Where(kv => before.TryGetValue(kv.Key, out var b) && b != kv.Value).Select(kv => kv.Key).Order(StringComparer.Ordinal).ToList();
        return AdminResult<VersionComparison>.Ok(new VersionComparison(from?.Version.VersionNo ?? 0, to.Version.VersionNo, LineDiff.Compute(from?.SqlText ?? "", to.SqlText), added, removed, changed));
    }

    private static Dictionary<string, string> Parameters(string? json)
    {
        if (json is null)
            return [];
        try
        {
            return ParameterDefinitionJson.Deserialize(json).ToDictionary(d => d.Name, d => ParameterDefinitionJson.Serialize([d]), StringComparer.Ordinal);
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>
    /// Restores an old version as a <b>new</b> version (history is never rewritten). The report is deactivated until the restored version is previewed
    /// again; restoring the current version is refused.
    /// </summary>
    public async Task<SaveVersionResult> RestoreAsync(int reportId, int versionNo, byte[] expectedRowVersion, CancellationToken cancellationToken)
    {
        var old = await store.GetVersionAsync(reportId, versionNo, cancellationToken);
        if (old is null)
            return new SaveVersionResult(null, false, false, null, new ReportStateProblem(404, ErrorCodes.NotFound, "This version does not exist."));
        if (old.Version.IsCurrent)
            return new SaveVersionResult(null, false, false, null, new ReportStateProblem(409, "ALREADY_CURRENT", "This is the current version already."));

        return await authoring.SaveAsync(
            new SaveReportCommand(reportId, expectedRowVersion, null, old.SqlText, old.ParametersJson, $"Restored version {versionNo}", false, new Dictionary<string, JsonElement>(), versionNo),
            cancellationToken);
    }

    // ---- Assignment ----

    public async Task<AdminResult<IReadOnlyList<RoleAssignmentRow>>> GetReportRolesAsync(int reportId, CancellationToken cancellationToken)
    {
        var rows = await store.GetReportRolesAsync(reportId, cancellationToken);
        return rows is null ? NotFound<IReadOnlyList<RoleAssignmentRow>>() : AdminResult<IReadOnlyList<RoleAssignmentRow>>.Ok(rows);
    }

    public async Task<AdminResult<AssignmentDiff>> SetReportRolesAsync(int reportId, IReadOnlyCollection<int>? roleIds, CancellationToken cancellationToken)
    {
        if (roleIds is null)
            return Invalid<AssignmentDiff>("Send the roles.", new Dictionary<string, IReadOnlyList<FieldError>> { ["roleIds"] = [new("REQUIRED", "Send the list of role ids (empty to remove all).")] });
        var result = await store.ReplaceReportRolesAsync(reportId, roleIds.Distinct().ToList(), user.UserId, cancellationToken);
        return result.Status switch
        {
            StoreStatus.Ok => AdminResult<AssignmentDiff>.Ok(result.Value!),
            StoreStatus.RoleMissing => AdminResult<AssignmentDiff>.Fail(422, "ROLE_NOT_FOUND", "One of the roles does not exist."),
            _ => NotFound<AssignmentDiff>(),
        };
    }

    public async Task<AdminResult<IReadOnlyList<ReportAssignmentRow>>> GetRoleReportsAsync(int roleId, CancellationToken cancellationToken)
    {
        var rows = await store.GetRoleReportsAsync(roleId, cancellationToken);
        return rows is null ? NotFound<IReadOnlyList<ReportAssignmentRow>>("This role does not exist.") : AdminResult<IReadOnlyList<ReportAssignmentRow>>.Ok(rows);
    }

    public async Task<AdminResult<AssignmentDiff>> SetRoleReportsAsync(int roleId, IReadOnlyCollection<int>? reportIds, CancellationToken cancellationToken)
    {
        if (reportIds is null)
            return Invalid<AssignmentDiff>("Send the reports.", new Dictionary<string, IReadOnlyList<FieldError>> { ["reportIds"] = [new("REQUIRED", "Send the list of report ids (empty to remove all).")] });
        var result = await store.ReplaceRoleReportsAsync(roleId, reportIds.Distinct().ToList(), user.UserId, cancellationToken);
        return result.Status switch
        {
            StoreStatus.Ok => AdminResult<AssignmentDiff>.Ok(result.Value!),
            StoreStatus.ReportMissing => AdminResult<AssignmentDiff>.Fail(422, "REPORT_NOT_FOUND", "One of the reports does not exist."),
            _ => NotFound<AssignmentDiff>("This role does not exist."),
        };
    }

    public Task<AssignmentMatrixRow> GetMatrixAsync(CancellationToken cancellationToken) => store.GetMatrixAsync(cancellationToken);

    // ---- Validation ----

    private Dictionary<string, IReadOnlyList<FieldError>>? DetailsErrors(ReportDetails d)
    {
        var errors = new Dictionary<string, IReadOnlyList<FieldError>>();
        var name = (d.Name ?? "").Trim();
        if (name.Length == 0)
            errors["name"] = [new("REQUIRED", "Enter a name.")];
        else if (name.Length > MaxNameLength)
            errors["name"] = [new("TOO_LONG", $"The name can have at most {MaxNameLength} characters.")];
        if (d.CategoryId <= 0)
            errors["categoryId"] = [new("REQUIRED", "Choose a category.")];
        if (d.Description is { Length: > MaxDescriptionLength })
            errors["description"] = [new("TOO_LONG", $"The description can have at most {MaxDescriptionLength} characters.")];
        if (d.HelpText is { Length: > MaxHelpTextLength })
            errors["helpText"] = [new("TOO_LONG", $"The help text can have at most {MaxHelpTextLength:N0} characters.")];
        if (d.SortOrder is < 0 or > 100_000)
            errors["sortOrder"] = [new("OUT_OF_RANGE", "The order must be between 0 and 100000.")];
        if (d.TimeoutSeconds is { } t && (t < 1 || t > _options.MaxTimeoutSeconds))
            errors["timeoutSeconds"] = [new("OUT_OF_RANGE", $"The time limit must be between 1 and {_options.MaxTimeoutSeconds} seconds.")];
        if (d.MaxRows is { } m && (m < 1 || m > _options.MaxRowsCeiling))
            errors["maxRows"] = [new("OUT_OF_RANGE", $"The row limit must be between 1 and {_options.MaxRowsCeiling:N0}.")];
        return errors.Count == 0 ? null : errors;
    }

    private static ReportDetails Clean(ReportDetails d) => d with { Name = d.Name.Trim(), Description = Blank(d.Description), HelpText = Blank(d.HelpText) };

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static AdminResult<T> NotFound<T>(string message = "This report does not exist.") => AdminResult<T>.Fail(404, ErrorCodes.NotFound, message);

    private static AdminResult<T> Invalid<T>(string message, IReadOnlyDictionary<string, IReadOnlyList<FieldError>> errors) => AdminResult<T>.Fail(422, "REPORT_DEFINITION_INVALID", message, errors);
}
