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
    /// Saves a report in one serializable transaction: checks the row version (when given), updates the unversioned details (when given) and appends a
    /// version (when text is given and it differs from the current one, or when it is a restore). Writes the audit events in the same transaction.
    /// When <see cref="SaveDefinition.PreviewedOk"/> the new version counts as previewed and an active report stays active; otherwise it is deactivated
    /// (unreviewed SQL is never served).
    /// </summary>
    Task<StoreResult<SaveOutcome>> SaveAsync(SaveDefinition save, CancellationToken cancellationToken);
}

/// <summary>What to save. <see cref="Details"/> null leaves the details alone; <see cref="SqlText"/> null saves no version.</summary>
/// <param name="ExpectedRowVersion">The row version the author last read; a different current value is a concurrent change.</param>
/// <param name="RestoredFromVersionNo">Set when the version is a copy of an older one (audited as a restore, always appended).</param>
public sealed record SaveDefinition(
    int ReportId,
    byte[]? ExpectedRowVersion,
    ReportDetails? Details,
    string? SqlText,
    byte[]? SqlHash,
    string? ParametersJson,
    string? ChangeNote,
    bool PreviewedOk,
    int? RestoredFromVersionNo,
    int? UserId);

/// <param name="VersionAdded">False when only details changed or nothing changed.</param>
/// <param name="Deactivated">True when an active report was deactivated by this save.</param>
public sealed record SaveOutcome(int VersionId, int VersionNo, bool IsActive, bool VersionAdded, bool Deactivated, byte[] RowVersion);
