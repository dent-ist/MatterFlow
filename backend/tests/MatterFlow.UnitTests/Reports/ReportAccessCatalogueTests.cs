using System.Text.Json;
using System.Text.RegularExpressions;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>
/// The access catalogue of the report login (db/report-access.json, issue #677): every table is a conscious allow/deny decision and the
/// GRANT/DENY lines for the role mf_report_reader in db/scripts equal the catalogue. A new table without an entry fails here.
/// </summary>
public partial class ReportAccessCatalogueTests
{
    private sealed record Entry(string Name, string Access, string Reason);

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "db", "report-access.json")))
            dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("db/report-access.json not found above the test output");
    }

    private static (List<Entry> Tables, HashSet<string> RunnerTables) Catalogue()
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(RepoRoot(), "db", "report-access.json")));
        var tables = doc.RootElement.GetProperty("tables").EnumerateArray()
            .Select(t => new Entry(t.GetProperty("name").GetString()!, t.GetProperty("access").GetString()!, t.GetProperty("reason").GetString()!))
            .ToList();
        var runner = doc.RootElement.GetProperty("runnerTables").EnumerateArray().Select(e => e.GetString()!).ToHashSet();
        return (tables, runner);
    }

    private static string[] ScriptTexts() =>
        Directory.GetFiles(Path.Combine(RepoRoot(), "db", "scripts"), "*.sql").Order().Select(File.ReadAllText).ToArray();

    [GeneratedRegex(@"^\s*CREATE\s+TABLE\s+(?:\[?dbo\]?\.)?\[?(\w+)\]?", RegexOptions.Multiline | RegexOptions.IgnoreCase)]
    private static partial Regex CreateTable();

    [GeneratedRegex(@"^(GRANT|DENY)\s+(.+?)\s+ON\s+(?:OBJECT::)?dbo\.(\w+)\s+TO\s+mf_report_reader\s*;", RegexOptions.Multiline | RegexOptions.IgnoreCase)]
    private static partial Regex ReaderStatement();

    [Fact]
    public void Every_table_created_by_a_script_is_classified_and_the_catalogue_has_no_unknown_table()
    {
        var (catalogue, runnerTables) = Catalogue();
        var created = ScriptTexts().SelectMany(s => CreateTable().Matches(s).Select(m => m.Groups[1].Value)).ToHashSet();

        created.Count.ShouldBeGreaterThan(40);
        created.Except(catalogue.Select(c => c.Name)).ShouldBeEmpty("tables without an allow/deny decision in db/report-access.json");
        catalogue.Select(c => c.Name).Except(created).Except(runnerTables).ShouldBeEmpty("catalogue entries for tables that no script creates");
    }

    [Fact]
    public void Catalogue_entries_are_unique_have_a_reason_and_use_allow_or_deny()
    {
        var (catalogue, _) = Catalogue();

        catalogue.Select(c => c.Name).Distinct().Count().ShouldBe(catalogue.Count);
        catalogue.ShouldAllBe(c => c.Access == "allow" || c.Access == "deny");
        catalogue.ShouldAllBe(c => c.Reason.Length > 10);
    }

    [Fact]
    public void Audit_credential_bookkeeping_and_report_tables_are_always_denied()
    {
        var (catalogue, _) = Catalogue();
        var access = catalogue.ToDictionary(c => c.Name, c => c.Access);

        foreach (var table in new[] { "AuditEvent", "AuditEventGuard", "UserIdentity", "SeedMarker", "SchemaMigration" })
            access[table].ShouldBe("deny", table);
        foreach (var table in access.Keys.Where(k => k.StartsWith("Report", StringComparison.Ordinal) || k is "RoleReport" or "SavedReportView"))
            access[table].ShouldBe("deny", table);
        access["Task"].ShouldBe("allow");
        access["Matter"].ShouldBe("allow");
    }

    [Fact]
    public void Grants_and_denies_in_the_scripts_equal_the_catalogue()
    {
        var (catalogue, _) = Catalogue();
        var statements = ScriptTexts()
            .SelectMany(s => ReaderStatement().Matches(s))
            .Select(m => (Verb: m.Groups[1].Value.ToUpperInvariant(), Rights: Regex.Replace(m.Groups[2].Value.ToUpperInvariant(), @"\s+", " "), Table: m.Groups[3].Value))
            .ToList();

        foreach (var entry in catalogue)
        {
            var mine = statements.Where(s => s.Table == entry.Name).ToList();
            if (entry.Access == "allow")
                mine.ShouldBe([("GRANT", "SELECT", entry.Name)], $"{entry.Name}: exactly one GRANT SELECT and no DENY");
            else
                mine.ShouldBe([("DENY", "SELECT, VIEW DEFINITION", entry.Name)], $"{entry.Name}: exactly one DENY SELECT, VIEW DEFINITION");
        }

        statements.Select(s => s.Table).Distinct().Except(catalogue.Select(c => c.Name)).ShouldBeEmpty("statements for tables outside the catalogue");
    }

    [Fact]
    public void The_report_role_never_joins_a_broad_role()
    {
        foreach (var script in ScriptTexts())
        {
            Regex.IsMatch(script, @"ALTER\s+ROLE\s+\[?(db_\w+|sysadmin|mf_app|mf_migrator)\]?\s+ADD\s+MEMBER\s+\[?mf_report_reader", RegexOptions.IgnoreCase).ShouldBeFalse();
            Regex.IsMatch(script, @"GRANT\s+(?!SELECT\s+ON\s+dbo\.)[^;]*\bTO\s+mf_report_reader", RegexOptions.IgnoreCase | RegexOptions.Singleline).ShouldBeFalse("the role only ever gets table-level SELECT");
        }
    }
}
