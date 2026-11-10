using System.Globalization;
using System.Text.Json;

namespace LptHub.Reports.Application;

/// <summary>Stable event codes written to <c>dbo.AuditEvent</c> for Reports (object type <c>Report</c>; spec 13). The Audit Logs object-type filter lists them.</summary>
public static class ReportAuditEvents
{
    public const string ObjectType = "Report";
    public const string CategoryObjectType = "ReportCategory";

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
public sealed record ReportAuditEntry(string EventType, int ReportId, string Summary, string? FieldKey = null, string? OldValue = null, string? NewValue = null, string ObjectType = ReportAuditEvents.ObjectType)
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

    /// <summary>Name, description, help text, order, time limit or row cap changed (no new version). Lists the fields, not their values.</summary>
    public static ReportAuditEntry DetailsChanged(int reportId, string name, IReadOnlyCollection<string> fields) =>
        new(ReportAuditEvents.Updated, reportId, Limit($"Report '{name}': details changed ({string.Join(", ", fields)})"), "details", null, Limit(string.Join(", ", fields), ValueLimit));

    public static ReportAuditEntry Activated(int reportId, string name, int versionNo) => new(ReportAuditEvents.Activated, reportId, Limit($"Report '{name}' activated (version {versionNo})"), "isActive", "false", "true");

    public static ReportAuditEntry Deactivated(int reportId, string name, string reason) => new(ReportAuditEvents.Deactivated, reportId, Limit($"Report '{name}' deactivated{(reason.Length == 0 ? "" : ": " + reason)}"), "isActive", "true", "false");

    public static ReportAuditEntry VersionRestored(int reportId, string name, int fromVersion, int newVersion) =>
        new(ReportAuditEvents.VersionRestored, reportId, Limit($"Report '{name}': version {fromVersion} restored as version {newVersion}"), "version", fromVersion.ToString(CultureInfo.InvariantCulture), newVersion.ToString(CultureInfo.InvariantCulture));

    /// <summary>A category was created or changed (object type <c>ReportCategory</c>, object id the category). Lists what changed, not the report names.</summary>
    public static ReportAuditEntry CategorySaved(int categoryId, string name, string? oldName, bool created, string change) =>
        new(ReportAuditEvents.CategoryChanged, categoryId, Limit(created ? $"Report category '{name}' created" : $"Report category '{name}': {change}"), "category", oldName, name, ReportAuditEvents.CategoryObjectType);

    public static ReportAuditEntry CategoryChanged(int reportId, string name, string? oldCategory, string newCategory) =>
        new(ReportAuditEvents.CategoryChanged, reportId, Limit($"Report '{name}' moved to category '{newCategory}'"), "category", oldCategory, newCategory);

    /// <summary>Roles added to and removed from a report's assignment (names, not ids, so the log stays readable after a rename).</summary>
    public static ReportAuditEntry RolesAssigned(int reportId, string name, IReadOnlyCollection<string> added, IReadOnlyCollection<string> removed) =>
        new(ReportAuditEvents.RolesAssigned, reportId, Limit($"Report '{name}': roles +{added.Count} -{removed.Count}"), "roles", Limit(string.Join(", ", removed), ValueLimit), Limit(string.Join(", ", added), ValueLimit));

    /// <summary>
    /// The compact run event. It carries <b>no parameter values</b> (issue #808, owner decision 2): only the parameter names and how many there were,
    /// because a value can be a matter, a client or a person's name and every holder of <c>Audit.View</c> can read this event while it has no matter scope.
    /// The values as bound stay in <c>dbo.ReportRun</c> for the people who hold <c>Report.Manage</c>.
    /// </summary>
    public static ReportAuditEntry RunCompleted(int reportId, string name, int versionNo, string status, int? rowCount, bool truncated, int? durationMs, string? errorCode, string? parametersJson)
    {
        var names = ParameterNames(parametersJson);
        return new(
            ReportAuditEvents.Run,
            reportId,
            Limit($"Ran report '{name}' (version {versionNo}): {status}{(rowCount is null ? "" : $", {rowCount} rows")}{(truncated ? " (cut off)" : "")}"),
            "run",
            null,
            Limit(JsonSerializer.Serialize(new { status, rows = rowCount, truncated, ms = durationMs, error = errorCode, version = versionNo, parameterNames = names, parameterCount = names.Count }), ValueLimit));
    }

    /// <summary>The names in the run log's <c>["NAME=value", ...]</c> text; nothing after the first <c>=</c> is ever read into the result. Anything that does not look like that gives no names.</summary>
    internal static IReadOnlyList<string> ParameterNames(string? parametersJson)
    {
        if (string.IsNullOrWhiteSpace(parametersJson))
            return [];
        try
        {
            using var document = JsonDocument.Parse(parametersJson);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
                return [];
            var names = new List<string>();
            foreach (var item in document.RootElement.EnumerateArray())
            {
                var text = item.ValueKind == JsonValueKind.String ? item.GetString() : null;
                var equals = text?.IndexOf('=', StringComparison.Ordinal) ?? -1;
                if (equals is > 0 and <= 64 && text![..equals].All(c => c is (>= 'A' and <= 'Z') or (>= '0' and <= '9') or '_'))
                    names.Add(text[..equals]);
            }

            return names;
        }
        catch (JsonException)
        {
            return [];
        }
    }

    public static ReportAuditEntry Exported(int reportId, string name, int versionNo, int exportedRows, string filterSummary, IReadOnlyList<string>? columns = null) =>
        new(ReportAuditEvents.Export, reportId, Limit($"Exported {exportedRows} rows of report '{name}' (version {versionNo}) as CSV"), "export", null, Limit(JsonSerializer.Serialize(new { rows = exportedRows, filter = filterSummary, version = versionNo, columns }), ValueLimit));

    private static string Limit(string text, int max = SummaryLimit) => text.Length <= max ? text : text[..(max - 3)] + "...";
}
