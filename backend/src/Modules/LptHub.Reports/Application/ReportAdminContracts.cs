namespace MatterFlow.Reports.Application;

/// <summary>What a store call came to. Not-found, concurrent change and duplicate name are normal outcomes, not exceptions.</summary>
public enum StoreStatus
{
    Ok,
    NotFound,
    Conflict,
    DuplicateName,
    CategoryInvalid,
    RoleMissing,
    ReportMissing,
}

public sealed record StoreResult<T>(StoreStatus Status, T? Value = default)
{
    public bool IsOk => Status == StoreStatus.Ok;

    public static StoreResult<T> Ok(T value) => new(StoreStatus.Ok, value);

    public static StoreResult<T> Fail(StoreStatus status) => new(status);
}

public sealed record CategoryRow(int CategoryId, string Name, int SortOrder, bool IsActive, int ReportCount, byte[] RowVersion);

public sealed record ReportListFilter(string? Status, int? CategoryId, string? Search);

public sealed record ReportListRow(
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
    byte[] RowVersion);

public sealed record ReportDetailRow(
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
    string? SqlText,
    string? ParametersJson,
    string? ChangeNote,
    int? LastPreviewOkVersionId,
    int RoleCount,
    DateTime CreatedAtUtc,
    string? CreatedByName,
    DateTime? ModifiedAtUtc,
    string? ModifiedByName,
    byte[] RowVersion);

/// <summary>The fields of a report that are not versioned (changing them writes no version).</summary>
public sealed record ReportDetails(string Name, int CategoryId, string? Description, string? HelpText, int SortOrder, int? TimeoutSeconds, int? MaxRows);

public sealed record NewReport(ReportDetails Details, string SqlText, byte[] SqlHash, string ParametersJson, string? ChangeNote, int? UserId);

public sealed record CreatedReport(int ReportId, int VersionId, int VersionNo, byte[] RowVersion);

public sealed record VersionRow(int VersionId, int VersionNo, DateTime CreatedAtUtc, int? CreatedByUserId, string? CreatedByName, string? ChangeNote, bool IsCurrent, string Hash);

public sealed record VersionDetail(VersionRow Version, string SqlText, string ParametersJson);

/// <summary>A role as the assignment screens show it. Never carries SQL.</summary>
public sealed record RoleAssignmentRow(int RoleId, string Name, string? Description, bool IsActive, bool IsSystemAdmin, int MemberCount, bool Assigned);

/// <summary>A report as the assignment screens show it: name, category and description only, never SQL.</summary>
public sealed record ReportAssignmentRow(int ReportId, string Name, int CategoryId, string CategoryName, int CategorySortOrder, int SortOrder, string? Description, bool IsActive, bool Assigned);

public sealed record NamedId(int Id, string Name);

/// <summary>What a replace changed.</summary>
public sealed record AssignmentDiff(IReadOnlyList<NamedId> Added, IReadOnlyList<NamedId> Removed, int AssignedCount, string OwnerName);

public sealed record AssignmentCell(int RoleId, int ReportId);

public sealed record AssignmentMatrixRow(IReadOnlyList<NamedId> Roles, IReadOnlyList<ReportAssignmentRow> Reports, IReadOnlyList<AssignmentCell> Cells);

/// <summary>Reads and writes the admin side of Reports with the application connection: categories, the report list, creation, versions and the assignment of reports to roles.</summary>
public interface IReportAdminStore
{
    Task<IReadOnlyList<CategoryRow>> ListCategoriesAsync(CancellationToken cancellationToken);

    Task<StoreResult<CategoryRow>> CreateCategoryAsync(string name, int sortOrder, int? userId, CancellationToken cancellationToken);

    Task<StoreResult<CategoryRow>> UpdateCategoryAsync(int categoryId, string name, int sortOrder, bool isActive, byte[] rowVersion, int? userId, CancellationToken cancellationToken);

    Task<IReadOnlyList<ReportListRow>> ListReportsAsync(ReportListFilter filter, CancellationToken cancellationToken);

    Task<ReportDetailRow?> GetReportAsync(int reportId, CancellationToken cancellationToken);

    Task<StoreResult<CreatedReport>> CreateReportAsync(NewReport report, CancellationToken cancellationToken);

    Task<IReadOnlyList<VersionRow>?> ListVersionsAsync(int reportId, CancellationToken cancellationToken);

    Task<VersionDetail?> GetVersionAsync(int reportId, int versionNo, CancellationToken cancellationToken);

    /// <summary>Every role with whether it holds the report; null when the report does not exist.</summary>
    Task<IReadOnlyList<RoleAssignmentRow>?> GetReportRolesAsync(int reportId, CancellationToken cancellationToken);

    /// <summary>Replaces the set of roles that hold the report and audits the difference as one event.</summary>
    Task<StoreResult<AssignmentDiff>> ReplaceReportRolesAsync(int reportId, IReadOnlyCollection<int> roleIds, int? userId, CancellationToken cancellationToken);

    /// <summary>Every report with whether the role holds it; null when the role does not exist.</summary>
    Task<IReadOnlyList<ReportAssignmentRow>?> GetRoleReportsAsync(int roleId, CancellationToken cancellationToken);

    /// <summary>Replaces the set of reports a role holds and audits one event per affected report.</summary>
    Task<StoreResult<AssignmentDiff>> ReplaceRoleReportsAsync(int roleId, IReadOnlyCollection<int> reportIds, int? userId, CancellationToken cancellationToken);

    Task<AssignmentMatrixRow> GetMatrixAsync(CancellationToken cancellationToken);
}
