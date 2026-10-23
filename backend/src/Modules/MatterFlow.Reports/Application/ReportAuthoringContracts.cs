namespace MatterFlow.Reports.Application;

/// <summary>A report as the authoring side sees it: the working row and its current version.</summary>
public sealed record AuthoringReport(
    int ReportId,
    string Name,
    bool IsActive,
    int? CurrentVersionId,
    int? CurrentVersionNo,
    string? SqlText,
    byte[]? SqlHash,
    string? ParametersJson,
    int? LastPreviewOkVersionId,
    int? TimeoutSeconds,
    int? MaxRows,
    byte[] RowVersion);

/// <summary>The result of appending a version.</summary>
public sealed record AddedVersion(int VersionId, int VersionNo, bool IsActive, byte[] RowVersion);

/// <summary>Reads and changes the report definition rows for authoring (application connection).</summary>
public interface IReportDefinitionStore
{
    Task<AuthoringReport?> GetAsync(int reportId, CancellationToken cancellationToken);

    /// <summary>Records that the current version passed a preview. Returns the new row version, or null when the report's current version has since changed.</summary>
    Task<byte[]?> MarkPreviewOkAsync(int reportId, int versionId, int? userId, CancellationToken cancellationToken);

    /// <summary>
    /// Activates (only while <c>LastPreviewOkVersionId = CurrentVersionId</c>; false otherwise) or deactivates. Returns the new row version, or null when the
    /// precondition failed.
    /// </summary>
    Task<byte[]?> SetActiveAsync(int reportId, bool active, int? userId, CancellationToken cancellationToken);

    /// <summary>
    /// Appends a version and makes it current in one transaction. When <paramref name="previewedOk"/> the version counts as previewed and an active report
    /// stays active; otherwise the report is deactivated (unreviewed SQL is never served).
    /// </summary>
    Task<AddedVersion> AddVersionAsync(int reportId, string sqlText, byte[] sqlHash, string parametersJson, string? changeNote, bool previewedOk, int? userId, CancellationToken cancellationToken);
}
