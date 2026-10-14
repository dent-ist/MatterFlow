using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

[Collection(SqlServerCollection.Name)]
public class SchemaMigrationRunnerTests(SqlServerFixture sql)
{
    private static (string, string) S(string name, string content) => (name, content);

    private static SchemaMigrationRunner Runner(string cs, params (string, string)[] scripts) =>
        Runner(cs, new InMemoryMigrationScriptSource(scripts));

    private static SchemaMigrationRunner Runner(string cs, IMigrationScriptSource source) =>
        new(cs, source, new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance);

    private static async Task<T> ScalarAsync<T>(string cs, string query)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = query;
        return (T)(await cmd.ExecuteScalarAsync())!;
    }

    [Fact]
    public async Task Fresh_database_applies_all_embedded_scripts_in_order_and_records_them()
    {
        var cs = await sql.CreateDatabaseAsync();
        var embedded = ScriptCatalog.Load(new EmbeddedMigrationScriptSource());
        embedded.ShouldNotBeEmpty();

        var applied = await Runner(cs, new EmbeddedMigrationScriptSource()).RunAsync();

        applied.ShouldBe(embedded.Select(s => s.Name));
        (await ScalarAsync<int>(cs, "SELECT COUNT(*) FROM dbo.SchemaMigration WHERE Success = 1")).ShouldBe(embedded.Count);
        (await ScalarAsync<string>(cs, "SELECT Checksum FROM dbo.SchemaMigration WHERE Prefix = 1")).ShouldBe(embedded[0].Checksum);
    }

    [Fact]
    public async Task Scripts_run_in_numeric_prefix_order_not_text_order()
    {
        var cs = await sql.CreateDatabaseAsync();

        var applied = await Runner(cs,
            S("10-c.sql", "INSERT dbo.Log(Item) VALUES ('10');"),
            S("09-b.sql", "INSERT dbo.Log(Item) VALUES ('09');"),
            S("01-a.sql", "CREATE TABLE dbo.Log(Id INT IDENTITY, Item VARCHAR(10));")).RunAsync();

        applied.ShouldBe(["01-a.sql", "09-b.sql", "10-c.sql"]);
        (await ScalarAsync<string>(cs, "SELECT STRING_AGG(Item, ',') WITHIN GROUP (ORDER BY Id) FROM dbo.Log")).ShouldBe("09,10");
    }

    [Fact]
    public async Task Second_run_applies_nothing()
    {
        var cs = await sql.CreateDatabaseAsync();
        var scripts = new[] { S("01-a.sql", "CREATE TABLE dbo.T1(Id INT);") };
        await Runner(cs, scripts).RunAsync();

        var second = await Runner(cs, scripts).RunAsync();

        second.ShouldBeEmpty();
        (await ScalarAsync<int>(cs, "SELECT COUNT(*) FROM dbo.SchemaMigration")).ShouldBe(1);
    }

    [Fact]
    public async Task Adding_a_new_script_runs_only_that_script()
    {
        var cs = await sql.CreateDatabaseAsync();
        var s1 = S("01-a.sql", "CREATE TABLE dbo.T1(Id INT);");
        var s2 = S("02-b.sql", "CREATE TABLE dbo.T2(Id INT);");
        await Runner(cs, s1, s2).RunAsync();

        var applied = await Runner(cs, s1, s2, S("03-c.sql", "CREATE TABLE dbo.T3(Id INT);")).RunAsync();

        applied.ShouldBe(["03-c.sql"]);
        (await ScalarAsync<int>(cs, "SELECT COUNT(*) FROM dbo.SchemaMigration")).ShouldBe(3);
    }

    [Fact]
    public async Task Edited_applied_script_fails_with_clear_error()
    {
        var cs = await sql.CreateDatabaseAsync();
        await Runner(cs, S("01-a.sql", "CREATE TABLE dbo.T1(Id INT);")).RunAsync();

        var ex = await Should.ThrowAsync<SchemaMigrationException>(
            () => Runner(cs, S("01-a.sql", "CREATE TABLE dbo.T1(Id BIGINT);")).RunAsync());

        ex.Message.ShouldContain("Checksum mismatch");
        ex.Message.ShouldContain("01-a.sql");
    }

    [Fact]
    public async Task Line_ending_only_change_of_applied_script_is_accepted()
    {
        var cs = await sql.CreateDatabaseAsync();
        await Runner(cs, S("01-a.sql", "SELECT 1;\nSELECT 2;")).RunAsync();

        var applied = await Runner(cs, S("01-a.sql", "﻿SELECT 1;\r\nSELECT 2;\r\n")).RunAsync();

        applied.ShouldBeEmpty();
    }

    [Fact]
    public async Task Duplicate_prefix_fails_and_applies_nothing()
    {
        var cs = await sql.CreateDatabaseAsync();

        var ex = await Should.ThrowAsync<SchemaMigrationException>(
            () => Runner(cs, S("05-a.sql", "SELECT 1;"), S("005-b.sql", "SELECT 1;")).RunAsync());

        ex.Message.ShouldContain("Duplicate");
        ex.Message.ShouldContain("05-a.sql");
        ex.Message.ShouldContain("005-b.sql");
        (await ScalarAsync<int>(cs, "SELECT COUNT(*) FROM sys.tables WHERE name = 'SchemaMigration'")).ShouldBe(0);
    }

    [Fact]
    public async Task Failing_script_rolls_back_is_not_recorded_and_aborts()
    {
        var cs = await sql.CreateDatabaseAsync();
        var ok = S("01-a.sql", "CREATE TABLE dbo.T1(Id INT);");
        var bad = S("02-bad.sql", "CREATE TABLE dbo.T2(Id INT);\nGO\nSELECT 1/0;");

        var ex = await Should.ThrowAsync<SchemaMigrationException>(() => Runner(cs, ok, bad).RunAsync());

        ex.Message.ShouldContain("02-bad.sql");
        ex.Message.ShouldContain("batch 2");
        (await ScalarAsync<int>(cs, "SELECT COUNT(*) FROM sys.tables WHERE name = 'T2'")).ShouldBe(0);
        (await ScalarAsync<int>(cs, "SELECT COUNT(*) FROM dbo.SchemaMigration")).ShouldBe(1);
        (await ScalarAsync<int>(cs, "SELECT COUNT(*) FROM sys.dm_tran_locks WHERE resource_type = 'APPLICATION'")).ShouldBe(0);
    }

    [Fact]
    public async Task Pending_script_with_prefix_below_highest_applied_fails()
    {
        var cs = await sql.CreateDatabaseAsync();
        await Runner(cs, S("01-a.sql", "SELECT 1;"), S("03-c.sql", "SELECT 1;")).RunAsync();

        var ex = await Should.ThrowAsync<SchemaMigrationException>(
            () => Runner(cs, S("01-a.sql", "SELECT 1;"), S("02-b.sql", "SELECT 1;"), S("03-c.sql", "SELECT 1;")).RunAsync());

        ex.Message.ShouldContain("02-b.sql");
    }

    [Fact]
    public async Task Applied_script_missing_from_application_fails()
    {
        var cs = await sql.CreateDatabaseAsync();
        await Runner(cs, S("01-a.sql", "SELECT 1;"), S("02-b.sql", "SELECT 1;")).RunAsync();

        var ex = await Should.ThrowAsync<SchemaMigrationException>(() => Runner(cs, S("01-a.sql", "SELECT 1;")).RunAsync());

        ex.Message.ShouldContain("02-b.sql");
        ex.Message.ShouldContain("missing");
    }

    [Fact]
    public async Task Go_separated_batches_with_go_inside_strings_run_correctly()
    {
        var cs = await sql.CreateDatabaseAsync();
        var script = "CREATE TABLE dbo.G(V NVARCHAR(50));\nGO\nINSERT dbo.G VALUES (N'a\nGO\nb');\nGO\n";

        await Runner(cs, S("01-g.sql", script)).RunAsync();

        (await ScalarAsync<string>(cs, "SELECT V FROM dbo.G")).ShouldBe("a\nGO\nb");
    }

    [Fact]
    public async Task No_transaction_directive_runs_outside_a_transaction_and_marks_success()
    {
        var cs = await sql.CreateDatabaseAsync();
        var script = "-- mf:no-transaction\nCREATE TABLE dbo.NT(Id INT);\nGO\nIF @@TRANCOUNT <> 0 THROW 50000, 'in transaction', 1;";

        var applied = await Runner(cs, S("01-nt.sql", script)).RunAsync();

        applied.ShouldBe(["01-nt.sql"]);
        (await ScalarAsync<bool>(cs, "SELECT Success FROM dbo.SchemaMigration")).ShouldBeTrue();
    }

    [Fact]
    public async Task Success_zero_row_blocks_startup()
    {
        var cs = await sql.CreateDatabaseAsync();
        await Runner(cs, S("01-a.sql", "SELECT 1;")).RunAsync();
        await using (var c = new SqlConnection(cs))
        {
            await c.OpenAsync();
            await using var cmd = c.CreateCommand();
            cmd.CommandText = "UPDATE dbo.SchemaMigration SET Success = 0";
            await cmd.ExecuteNonQueryAsync();
        }

        var ex = await Should.ThrowAsync<SchemaMigrationException>(() => Runner(cs, S("01-a.sql", "SELECT 1;")).RunAsync());

        ex.Message.ShouldContain("Success=0");
    }

    [Fact]
    public async Task Concurrent_runners_serialize_and_apply_each_script_exactly_once()
    {
        var cs = await sql.CreateDatabaseAsync();
        var scripts = new[]
        {
            S("01-a.sql", "CREATE TABLE dbo.Counter(Id INT IDENTITY PRIMARY KEY, Who INT NOT NULL DEFAULT 1);"),
            S("02-slow.sql", "WAITFOR DELAY '00:00:02';\nGO\nINSERT dbo.Counter DEFAULT VALUES;"),
        };

        var results = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => Task.Run(() => Runner(cs, scripts).RunAsync())));

        results.Sum(r => r.Count).ShouldBe(2);
        results.Count(r => r.Count == 2).ShouldBe(1);
        (await ScalarAsync<int>(cs, "SELECT COUNT(*) FROM dbo.Counter")).ShouldBe(1);
        (await ScalarAsync<int>(cs, "SELECT COUNT(*) FROM dbo.SchemaMigration")).ShouldBe(2);
    }

    [Fact]
    public async Task Folder_source_discovers_scripts()
    {
        var cs = await sql.CreateDatabaseAsync();
        var dir = Directory.CreateTempSubdirectory("mf-scripts-");
        try
        {
            await File.WriteAllTextAsync(Path.Combine(dir.FullName, "01-a.sql"), "CREATE TABLE dbo.F(Id INT);");
            await File.WriteAllTextAsync(Path.Combine(dir.FullName, "notes.txt"), "ignored");

            var applied = await Runner(cs, new FolderMigrationScriptSource(dir.FullName)).RunAsync();

            applied.ShouldBe(["01-a.sql"]);
        }
        finally
        {
            dir.Delete(true);
        }
    }
}
