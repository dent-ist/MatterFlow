using System.Reflection;
using System.Text.Json;

namespace MatterFlow.Reports.Application;

/// <summary>
/// The access catalogue of the report login (<c>db/report-access.json</c>, embedded): which tables the role <c>mf_report_reader</c> may read.
/// The database is the enforcement; this copy lets the startup probe and the schema browser check the effective rights against the intent.
/// </summary>
public sealed class ReportAccessCatalogue
{
    private ReportAccessCatalogue(IReadOnlyList<string> allowed, IReadOnlyList<string> denied)
    {
        Allowed = allowed;
        Denied = denied;
    }

    /// <summary>Tables the report login may read.</summary>
    public IReadOnlyList<string> Allowed { get; }

    /// <summary>Tables that are explicitly denied (audit, identities, bookkeeping, authorization, Reports' own tables).</summary>
    public IReadOnlyList<string> Denied { get; }

    private static readonly Lazy<ReportAccessCatalogue> Instance = new(Load);

    public static ReportAccessCatalogue Current => Instance.Value;

    public static ReportAccessCatalogue Parse(Stream json)
    {
        using var doc = JsonDocument.Parse(json);
        var tables = doc.RootElement.GetProperty("tables").EnumerateArray()
            .Select(t => (Name: t.GetProperty("name").GetString()!, Allow: t.GetProperty("access").GetString() == "allow"))
            .ToList();
        return new ReportAccessCatalogue(
            tables.Where(t => t.Allow).Select(t => t.Name).Order(StringComparer.Ordinal).ToList(),
            tables.Where(t => !t.Allow).Select(t => t.Name).Order(StringComparer.Ordinal).ToList());
    }

    private static ReportAccessCatalogue Load()
    {
        using var stream = typeof(ReportAccessCatalogue).Assembly.GetManifestResourceStream("db.report-access.json")
            ?? throw new InvalidOperationException("The embedded report access catalogue (db/report-access.json) is missing.");
        return Parse(stream);
    }
}
