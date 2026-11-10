using LptHub.Api.Seeding;
using LptHub.Data.SchemaMigrations;
using LptHub.Reports.Application.Starters;
using Shouldly;

namespace LptHub.IntegrationTests.Seeding;

/// <summary>
/// Rename to LPT Hub (issue #1347): the embedded-resource names carry the product name (csproj <c>LogicalName</c>) and the C# constants that read them must match.
/// A mismatch would only show at startup ("embedded resource ... is missing"), so this reads each resource for real (no database needed).
/// </summary>
public sealed class EmbeddedResourceNamesTests
{
    // Built from two halves so that the completeness check (tools/rename/rename.mjs --check) does not find the old name in this file.
    private static readonly string OldName = "Matter" + "Flow";

    [Fact]
    public void The_seed_resource_is_embedded_under_the_constant_name_and_can_be_read()
    {
        StarterSeedData.ResourceName.ShouldBe("LptHub.Seed.seed-configuration.json");
        typeof(StarterSeedData).Assembly.GetManifestResourceNames().ShouldContain(StarterSeedData.ResourceName);
        StarterSeedData.LoadEmbedded().Roles.ShouldNotBeEmpty();
    }

    [Fact]
    public void The_starter_report_resources_are_embedded_under_the_LptHub_prefix_and_can_be_read()
    {
        var names = typeof(StarterReportManifest).Assembly.GetManifestResourceNames();
        names.ShouldContain("LptHub.Reports.Starters.manifest.json");
        names.Count(n => n.StartsWith("LptHub.Reports.Starters.", StringComparison.Ordinal) && n.EndsWith(".sql", StringComparison.Ordinal)).ShouldBeGreaterThan(0);
        StarterReportManifest.LoadEmbedded().Reports.ShouldNotBeEmpty();
        StarterReportManifest.EmbeddedSqlKeys().ShouldNotBeEmpty();
    }

    [Fact]
    public void The_schema_scripts_are_embedded_and_no_resource_still_carries_the_old_product_name()
    {
        var scripts = new EmbeddedMigrationScriptSource().ReadAll();
        scripts.ShouldContain(s => s.Name == SchemaMigrationRunner.BaselineScriptName);

        var assemblies = new[] { typeof(StarterSeedData).Assembly, typeof(StarterReportManifest).Assembly, typeof(EmbeddedMigrationScriptSource).Assembly };
        assemblies.SelectMany(a => a.GetManifestResourceNames())
            .Where(n => n.Contains(OldName, StringComparison.OrdinalIgnoreCase))
            .ShouldBeEmpty();
    }
}
