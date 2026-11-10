using System.Text.RegularExpressions;
using MatterFlow.Data.SchemaMigrations;
using Shouldly;

namespace MatterFlow.SchemaTests;

public class ScriptsFolderTests
{
    private static string ScriptsDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
            dir = dir.Parent;

        dir.ShouldNotBeNull();
        return Path.Combine(dir.FullName, "db", "scripts");
    }

    [Fact]
    public void Db_scripts_folder_with_authoring_readme_exists()
    {
        File.Exists(Path.Combine(ScriptsDir(), "README.md")).ShouldBeTrue();
    }

    [Fact]
    public void The_baseline_is_prefix_zero_and_every_later_script_is_numbered_67_or_higher()
    {
        var names = Directory.GetFiles(ScriptsDir(), "*.sql").Select(Path.GetFileName).Order().ToList();

        names.ShouldContain(SchemaMigrationRunner.BaselineScriptName);
        MigrationScript.Create(SchemaMigrationRunner.BaselineScriptName, "SELECT 1;").Prefix.ShouldBe(0);
        foreach (var name in names.Where(n => n != SchemaMigrationRunner.BaselineScriptName))
            int.Parse(Regex.Match(name!, @"^\d+").Value).ShouldBeGreaterThanOrEqualTo(67, $"{name}: the numbers up to 66 belong to the archived chain");
    }

    [Fact]
    public void The_old_chain_is_archived_and_the_application_embeds_only_the_current_scripts()
    {
        var archive = Directory.GetFiles(Path.Combine(ScriptsDir(), "archive"), "*.sql").Select(Path.GetFileName).Order().ToList();
        archive.Count.ShouldBe(63);
        archive.First().ShouldBe("01-init.sql");
        archive.Last().ShouldBe("66-director-be-manager.sql");

        var embedded = new EmbeddedMigrationScriptSource().ReadAll().Select(s => s.Name).Order().ToList();
        embedded.ShouldBe(Directory.GetFiles(ScriptsDir(), "*.sql").Select(Path.GetFileName).Order().ToList()!);
        embedded.ShouldNotContain("01-init.sql");
    }
}
