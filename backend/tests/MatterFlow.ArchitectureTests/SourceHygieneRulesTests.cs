using Shouldly;

namespace MatterFlow.ArchitectureTests;

/// <summary>Source-level guard rails from security review 1 that are cheap to check and expensive to rediscover.</summary>
public class SourceHygieneRulesTests
{
    private static IEnumerable<string> ProductSources()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
            dir = dir.Parent;

        dir.ShouldNotBeNull();
        return Directory.EnumerateFiles(Path.Combine(dir.FullName, "backend", "src"), "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal));
    }

    /// <summary>SEC-16: SQL Server messages are localized; duplicate keys are recognized by error number (2601, 2627).</summary>
    [Fact]
    public void Duplicate_keys_are_never_detected_by_message_text()
    {
        var offenders = ProductSources()
            .Where(f => File.ReadAllText(f).Contains("\"duplicate key\"", StringComparison.OrdinalIgnoreCase))
            .Select(Path.GetFileName)
            .Order()
            .ToList();

        offenders.ShouldBeEmpty("Use SqlException.Number is 2601 or 2627 instead of matching message text: " + string.Join(", ", offenders));
    }

    /// <summary>
    /// Epic #758 PX-02 (#760): "matters managed by X" is one rule (<c>IManagedMatterScope</c>), and that seam is where the sensitive-matter visibility hook is applied.
    /// A query that compares the Primary or Secondary manager column with a value anywhere else copies the rule and would bypass the hook. The only places that may:
    /// the rule itself and the visibility predicate (SharedKernel), and the change detection of the manager write path in MatterService.
    /// A new endpoint that needs a "managed by" filter calls <c>IManagedMatterScope</c>; extending this list needs a reason in the commit.
    /// </summary>
    [Fact]
    public void Managed_by_filters_go_through_the_shared_scope_and_so_through_the_visibility_hook()
    {
        var pattern = new System.Text.RegularExpressions.Regex(@"(Primary|Secondary)ManagerId\s*(==|!=)(?>\s*)(?!null\b)", System.Text.RegularExpressions.RegexOptions.CultureInvariant);
        var allowed = new Dictionary<string, int>
        {
            ["VisibilityPredicates.cs"] = 2,
            ["MatterService.cs"] = 2, // changed-manager detection when the managers are set (a write, not a filter)
        };
        var found = ProductSources()
            .Select(f => (Name: Path.GetFileName(f), Count: pattern.Matches(File.ReadAllText(f)).Count))
            .Where(x => x.Count > 0)
            .ToDictionary(x => x.Name, x => x.Count);

        found.OrderBy(kv => kv.Key, StringComparer.Ordinal).ToList()
            .ShouldBe(allowed.OrderBy(kv => kv.Key, StringComparer.Ordinal).ToList(),
                "A manager column is compared outside the shared scope. Use IManagedMatterScope (WhereManagedBy / WhereMatterManagedBy) so the visibility hook of the sensitive-matter epic applies.");
    }

    /// <summary>Reports epic #671 (spec 7.10, 16.3 e): only the Reports module reads the report connection, so nothing else can run SQL as the report login.</summary>
    [Fact]
    public void Only_the_reports_module_reads_the_report_connection_string()
    {
        var offenders = ProductSources()
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}MatterFlow.Reports{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Where(f => File.ReadAllText(f).Contains("ReportsReadOnly", StringComparison.Ordinal))
            .Select(Path.GetFileName)
            .Order()
            .ToList();

        offenders.ShouldBeEmpty("Only MatterFlow.Reports may resolve ConnectionStrings:ReportsReadOnly: " + string.Join(", ", offenders));
    }

    /// <summary>Inside the module only <c>ReportsAvailability</c> (the report login) and <c>ReportAppConnection</c> (the application's own, for the Reports tables) read connection strings; everything else asks <c>IReportsAvailability.ReportConnectionString</c>, which is null unless the login passed the probe.</summary>
    [Fact]
    public void Inside_the_reports_module_two_classes_read_connection_strings_and_they_stay_apart()
    {
        var offenders = ProductSources()
            .Where(f => f.Contains($"{Path.DirectorySeparatorChar}MatterFlow.Reports{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Where(f => File.ReadAllText(f).Contains("GetConnectionString(", StringComparison.Ordinal))
            .Select(Path.GetFileName)
            .Order()
            .ToList();

        offenders.ShouldBe(["ReportAppConnection.cs", "ReportsAvailability.cs"]);

        // The executor (the code that runs report SQL) never touches the application connection; the availability class never reads the application's.
        var module = ProductSources().Where(f => f.Contains($"{Path.DirectorySeparatorChar}MatterFlow.Reports{Path.DirectorySeparatorChar}", StringComparison.Ordinal)).ToList();
        File.ReadAllText(module.Single(f => f.EndsWith("ReportExecutor.cs", StringComparison.Ordinal))).ShouldNotContain("ReportAppConnection");
        File.ReadAllText(module.Single(f => f.EndsWith("ReportAppConnection.cs", StringComparison.Ordinal))).ShouldNotContain("ReportsReadOnly");
    }
}
