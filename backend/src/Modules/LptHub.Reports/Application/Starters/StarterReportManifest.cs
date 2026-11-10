using System.Reflection;
using System.Text.Json;

namespace LptHub.Reports.Application.Starters;

/// <summary>One starter report as the manifest describes it, with its SQL text.</summary>
/// <param name="Key">Stable identifier and the name of the embedded <c>.sql</c> file (<c>&lt;key&gt;.sql</c>). The seed marker is <c>reports.starter.&lt;key&gt;</c>.</param>
/// <param name="ListsMatterNames">True when the result shows matter names (the sensitive-matter note of the runbook is about these).</param>
/// <param name="Roles">Names of the roles that receive the report. Empty for every starter: no starter role holds <c>Report.Run</c>.</param>
/// <param name="Columns">The column names the SQL returns, in order (the integration test compares them with the real result).</param>
/// <param name="ParametersJson">The parameter definitions as a JSON array in the shape of <c>ParameterDefinitionJson</c>.</param>
public sealed record StarterReport(
    string Key,
    string Name,
    string Category,
    int SortOrder,
    string Description,
    string? HelpText,
    bool ListsMatterNames,
    IReadOnlyList<string> Roles,
    IReadOnlyList<string> Columns,
    string ParametersJson,
    string Sql)
{
    public string MarkerName => StarterReportManifest.MarkerPrefix + Key;
}

public sealed record StarterCategory(string Name, int SortOrder);

/// <summary>
/// The starter reports shipped inside the assembly: <c>Starters/manifest.json</c> and one <c>Starters/&lt;key&gt;.sql</c> per report (embedded resources).
/// A report is plain data; the seeder (<see cref="ReportStarterSeeder"/>) creates it through the normal report tables and nothing else reads this class.
/// </summary>
public sealed class StarterReportManifest
{
    public const string MarkerPrefix = "reports.starter.";
    private const string ResourcePrefix = "LptHub.Reports.Starters.";
    private const string ManifestResource = ResourcePrefix + "manifest.json";

    private StarterReportManifest(IReadOnlyList<StarterCategory> categories, IReadOnlyList<StarterReport> reports)
    {
        Categories = categories;
        Reports = reports;
    }

    public IReadOnlyList<StarterCategory> Categories { get; }

    public IReadOnlyList<StarterReport> Reports { get; }

    /// <summary>Keys of the <c>.sql</c> files that are embedded in the assembly (the file name without <c>.sql</c>).</summary>
    public static IReadOnlyList<string> EmbeddedSqlKeys() =>
        [.. typeof(StarterReportManifest).Assembly.GetManifestResourceNames()
            .Where(n => n.StartsWith(ResourcePrefix, StringComparison.Ordinal) && n.EndsWith(".sql", StringComparison.Ordinal))
            .Select(n => n[ResourcePrefix.Length..^".sql".Length])
            .Order(StringComparer.Ordinal)];

    public static StarterReportManifest LoadEmbedded() => Load(typeof(StarterReportManifest).Assembly);

    public static StarterReportManifest Load(Assembly assembly)
    {
        using var stream = assembly.GetManifestResourceStream(ManifestResource)
            ?? throw new InvalidOperationException($"The embedded resource {ManifestResource} is missing.");
        using var document = JsonDocument.Parse(stream);
        var root = document.RootElement;

        var categories = root.GetProperty("categories").EnumerateArray()
            .Select(c => new StarterCategory(c.GetProperty("name").GetString()!, c.GetProperty("sortOrder").GetInt32()))
            .ToList();

        var reports = new List<StarterReport>();
        foreach (var r in root.GetProperty("reports").EnumerateArray())
        {
            var key = r.GetProperty("key").GetString()!;
            reports.Add(new StarterReport(
                key,
                r.GetProperty("name").GetString()!,
                r.GetProperty("category").GetString()!,
                r.GetProperty("sortOrder").GetInt32(),
                r.GetProperty("description").GetString()!,
                r.TryGetProperty("helpText", out var help) ? help.GetString() : null,
                r.GetProperty("listsMatterNames").GetBoolean(),
                [.. r.GetProperty("roles").EnumerateArray().Select(x => x.GetString()!)],
                [.. r.GetProperty("columns").EnumerateArray().Select(x => x.GetString()!)],
                r.GetProperty("parameters").GetRawText(),
                ReadSql(assembly, key)));
        }

        return new StarterReportManifest(categories, reports);
    }

    private static string ReadSql(Assembly assembly, string key)
    {
        var name = ResourcePrefix + key + ".sql";
        using var stream = assembly.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"The starter report '{key}' has no embedded SQL file ({name}).");
        using var reader = new StreamReader(stream, System.Text.Encoding.UTF8);
        return reader.ReadToEnd();
    }
}
