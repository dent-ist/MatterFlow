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
}
