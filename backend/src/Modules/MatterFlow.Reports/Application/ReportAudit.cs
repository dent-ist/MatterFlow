using System.Globalization;
using System.Text.Json;

namespace MatterFlow.Reports.Application;

/// <summary>Stable event codes written to <c>dbo.AuditEvent</c> for Reports (object type <c>Report</c>; spec 13). The Audit Logs object-type filter lists them.</summary>
public static class ReportAuditEvents
{
    public const string ObjectType = "Report";

    public const string Created = "REPORT_CREATED";
    public const string Updated = "REPORT_UPDATED";
    public const string ParametersChanged = "REPORT_PARAMETERS_CHANGED";
    public const string ChoiceSqlChanged = "REPORT_CHOICE_SQL_CHANGED";
    public const string Activated = "REPORT_ACTIVATED";
    public const string Deactivated = "REPORT_DEACTIVATED";
    public const string VersionRestored = "REPORT_VERSION_RESTORED";
    public const string CategoryChanged = "REPORT_CATEGORY_CHANGED";
    public const string RolesAssigned = "REPORT_ROLES_ASSIGNED";
    public const string Run = "REPORT_RUN";
    public const string Export = "REPORT_EXPORT";

    public static IReadOnlyList<string> All { get; } = [Created, Updated, ParametersChanged, ChoiceSqlChanged, Activated, Deactivated, VersionRestored, CategoryChanged, RolesAssigned, Run, Export];
}

/// <summary>One audit row about a report. The full SQL is never part of it: versions hold the text, events hold the version number and a short hash.</summary>
public sealed record ReportAuditEntry(string EventType, int ReportId, string Summary, string? FieldKey = null, string? OldValue = null, string? NewValue = null)
{
    public const int SummaryLimit = 500;
    public const int ValueLimit = 4000;

    /// <summary>First 16 hex characters of a SQL hash: enough to tell versions apart, useless to rebuild the text.</summary>
    public static string ShortHash(byte[]? hash) => hash is null ? "" : Convert.ToHexString(hash)[..16];

    public static ReportAuditEntry Created(int reportId, string name) => new(ReportAuditEvents.Created, reportId, Limit($"Report '{name}' created"));

    public static ReportAuditEntry Updated(int reportId, string name, int? oldVersion, byte[]? oldHash, int newVersion, byte[] newHash) =>
        new(ReportAuditEvents.Updated, reportId, Limit($"Report '{name}': SQL saved as version {newVersion}"), "sql", oldVersion is null ? null : $"v{oldVersion} {ShortHash(oldHash)}", $"v{newVersion} {ShortHash(newHash)}");

    public static ReportAuditEntry ParametersChanged(int reportId, string name, int newVersion, IReadOnlyCollection<string> oldNames, IReadOnlyCollection<string> newNames) =>
        new(ReportAuditEvents.ParametersChanged, reportId, Limit($"Report '{name}': parameters changed in version {newVersion}"), "parameters", Limit(string.Join(", ", oldNames), ValueLimit), Limit(string.Join(", ", newNames), ValueLimit));

    public static ReportAuditEntry ChoiceSqlChanged(int reportId, string name, string parameter, byte[]? oldHash, byte[] newHash) =>
        new(ReportAuditEvents.ChoiceSqlChanged, reportId, Limit($"Report '{name}': choice list query of {parameter} changed"), "choiceSql:" + parameter, ShortHash(oldHash), ShortHash(newHash));

    public static ReportAuditEntry Activated(int reportId, string name, int versionNo) => new(ReportAuditEvents.Activated, reportId, Limit($"Report '{name}' activated (version {versionNo})"), "isActive", "false", "true");

    public static ReportAuditEntry Deactivated(int reportId, string name, string reason) => new(ReportAuditEvents.Deactivated, reportId, Limit($"Report '{name}' deactivated{(reason.Length == 0 ? "" : ": " + reason)}"), "isActive", "true", "false");

    public static ReportAuditEntry VersionRestored(int reportId, string name, int fromVersion, int newVersion) =>
        new(ReportAuditEvents.VersionRestored, reportId, Limit($"Report '{name}': version {fromVersion} restored as version {newVersion}"), "version", fromVersion.ToString(CultureInfo.InvariantCulture), newVersion.ToString(CultureInfo.InvariantCulture));

    public static ReportAuditEntry CategoryChanged(int reportId, string name, string? oldCategory, string newCategory) =>
        new(ReportAuditEvents.CategoryChanged, reportId, Limit($"Report '{name}' moved to category '{newCategory}'"), "category", oldCategory, newCategory);

    /// <summary>Roles added to and removed from a report's assignment (names, not ids, so the log stays readable after a rename).</summary>
    public static ReportAuditEntry RolesAssigned(int reportId, string name, IReadOnlyCollection<string> added, IReadOnlyCollection<string> removed) =>
        new(ReportAuditEvents.RolesAssigned, reportId, Limit($"Report '{name}': roles +{added.Count} -{removed.Count}"), "roles", Limit(string.Join(", ", removed), ValueLimit), Limit(string.Join(", ", added), ValueLimit));

    public static ReportAuditEntry RunCompleted(int reportId, string name, int versionNo, string status, int? rowCount, bool truncated, int? durationMs, string? errorCode, string? parametersJson) =>
        new(
            ReportAuditEvents.Run,
            reportId,
            Limit($"Ran report '{name}' (version {versionNo}): {status}{(rowCount is null ? "" : $", {rowCount} rows")}{(truncated ? " (cut off)" : "")}"),
            "run",
            null,
            Limit(JsonSerializer.Serialize(new { status, rows = rowCount, truncated, ms = durationMs, error = errorCode, version = versionNo, parameters = ParseOrNull(parametersJson) }), ValueLimit));

    public static ReportAuditEntry Exported(int reportId, string name, int versionNo, int exportedRows, string filterSummary) =>
        new(ReportAuditEvents.Export, reportId, Limit($"Exported {exportedRows} rows of report '{name}' (version {versionNo}) as CSV"), "export", null, Limit(JsonSerializer.Serialize(new { rows = exportedRows, filter = filterSummary, version = versionNo }), ValueLimit));

    private static JsonElement? ParseOrNull(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return null;
        try
        {
            return JsonDocument.Parse(json).RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string Limit(string text, int max = SummaryLimit) => text.Length <= max ? text : text[..(max - 3)] + "...";
}
