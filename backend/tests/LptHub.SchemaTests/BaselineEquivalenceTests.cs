using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>
/// Issue #1307: the baseline (db/scripts/00-baseline.sql) builds exactly the database the old script chain built. Database A is made by the real runner
/// from the archived scripts (db/scripts/archive, 01 to 66), database B from the embedded baseline. tools/db/schema-fingerprint.sql describes both
/// (tables, columns, constraints, indexes, triggers, routines, roles, permissions, seed rows, identity counters) and the two descriptions must be equal.
/// Role names (rename to LPT Hub, issue #1348): the archived scripts, which are never edited, create the roles mf_app, mf_migrator and mf_report_reader; the
/// baseline creates lpt_app, lpt_migrator and lpt_report_reader. The fingerprint script maps the legacy names to the new ones with a fixed, explicit mapping
/// (see the header of tools/db/schema-fingerprint.sql), and this test first proves that the two databases really carry the different names, so the mapping
/// cannot hide a missing role.
/// </summary>
[Collection(SqlServerCollection.Name)]
public class BaselineEquivalenceTests(SqlServerFixture sql)
{
    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
            dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("repository root (global.json) not found above the test output");
    }

    private static Task RunAsync(string cs, IMigrationScriptSource source) =>
        new SchemaMigrationRunner(cs, source, new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

    private static readonly string[] LegacyRoles = ["mf_app", "mf_migrator", "mf_report_reader"];
    private static readonly string[] NewRoles = ["lpt_app", "lpt_migrator", "lpt_report_reader"];

    private static async Task<List<string>> RolesAsync(string cs)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT name FROM sys.database_principals WHERE type = 'R' AND (name LIKE 'mf[_]%' OR name LIKE 'lpt[_]%') ORDER BY name";
        var names = new List<string>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            names.Add(r.GetString(0));
        return names;
    }

    private static async Task<List<string>> FingerprintAsync(string cs)
    {
        var script = await File.ReadAllTextAsync(Path.Combine(RepoRoot(), "tools", "db", "schema-fingerprint.sql"));
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = script;
        cmd.CommandTimeout = 120;
        var lines = new List<string>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            lines.Add(r.GetString(0));
        return lines;
    }

    [Fact]
    public async Task The_baseline_builds_the_same_database_as_the_old_script_chain()
    {
        var archive = Path.Combine(RepoRoot(), "db", "scripts", "archive");
        var oldChain = new FolderMigrationScriptSource(archive);
        oldChain.ReadAll().Count.ShouldBe(63);

        var a = await sql.CreateDatabaseAsync();
        var b = await sql.CreateDatabaseAsync();
        await RunAsync(a, oldChain);
        // Only the baseline: scripts numbered 67 and higher (later changes) are not part of the comparison with the archived chain.
        var baselineOnly = new InMemoryMigrationScriptSource(new EmbeddedMigrationScriptSource().ReadAll().Where(s => s.Name == SchemaMigrationRunner.BaselineScriptName));
        var applied = await new SchemaMigrationRunner(b, baselineOnly, new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

        applied.ShouldBe([SchemaMigrationRunner.BaselineScriptName]);

        // The archived chain still has the legacy role names, the baseline the new ones; the fingerprint compares them under the documented mapping.
        (await RolesAsync(a)).ShouldBe(LegacyRoles.Order(StringComparer.Ordinal).ToList());
        (await RolesAsync(b)).ShouldBe(NewRoles.Order(StringComparer.Ordinal).ToList());

        var fa = await FingerprintAsync(a);
        var fb = await FingerprintAsync(b);

        fa.Count.ShouldBeGreaterThan(1500, "the fingerprint must describe the whole schema");
        fa.Where(l => l.StartsWith("column |", StringComparison.Ordinal)).Count().ShouldBeGreaterThan(700);
        fa.Except(fb).Select(l => "only in the old chain:   " + l)
            .Concat(fb.Except(fa).Select(l => "only in the baseline:    " + l))
            .ShouldBeEmpty("the baseline and the archived chain must produce the same schema");
        fb.ShouldBe(fa);
    }
}
