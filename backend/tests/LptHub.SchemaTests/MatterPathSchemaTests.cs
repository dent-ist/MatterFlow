using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Script 78 (epic #1389, issue #1391): a matter's DMS and DFS paths are rows of dbo.MatterPath; the two old columns are gone.</summary>
[Collection(SqlServerCollection.Name)]
public class MatterPathSchemaTests(SqlServerFixture sql)
{
    private static async Task<object?> ScalarAsync(string cs, string text)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = text;
        return await cmd.ExecuteScalarAsync();
    }

    private static MigrationsOptions Options => new() { LockTimeoutSeconds = 60 };

    [Fact]
    public async Task Existing_single_paths_become_position_one_rows_and_the_old_columns_are_gone()
    {
        var cs = await sql.CreateDatabaseAsync();
        var all = new EmbeddedMigrationScriptSource().ReadAll();
        await new SchemaMigrationRunner(cs, new InMemoryMigrationScriptSource(all.Where(s => string.CompareOrdinal(s.Name, "78-") < 0)), Options, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

        await ScalarAsync(cs, "INSERT dbo.Client (ClientNumber, Name) VALUES ('00001', N'Client')");
        await ScalarAsync(cs, @"
            INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name, DmsPath, DfsPath)
            SELECT c.ClientId, c.ClientNumber, v.Number, v.Name, v.Dms, v.Dfs
            FROM dbo.Client c CROSS JOIN (VALUES
              ('00001', N'Both', N'\\fs01\dms\one', N'https://dfs.example.com/one'),
              ('00002', N'Dms only', N'  https://dms.example.com/two  ', NULL),
              ('00003', N'Blank and none', N'   ', NULL),
              ('00004', N'Dfs only', NULL, N'\\fs02\dfs\four')) v (Number, Name, Dms, Dfs)");

        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), Options, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.MatterPath")).ShouldBe(4);
        (await ScalarAsync(cs, "SELECT CONCAT(p.Kind, '|', p.Position, '|', p.Path) FROM dbo.MatterPath p JOIN dbo.Matter m ON m.MatterId = p.MatterId WHERE m.MatterNumber = '00002'")).ShouldBe("DMS|1|https://dms.example.com/two");
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.MatterPath p JOIN dbo.Matter m ON m.MatterId = p.MatterId WHERE m.MatterNumber = '00001' AND p.Position = 1")).ShouldBe(2);
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.MatterPath p JOIN dbo.Matter m ON m.MatterId = p.MatterId WHERE m.MatterNumber = '00003'")).ShouldBe(0);
        (await ScalarAsync(cs, "SELECT p.Path FROM dbo.MatterPath p JOIN dbo.Matter m ON m.MatterId = p.MatterId WHERE m.MatterNumber = '00004' AND p.Kind = 'DFS'")).ShouldBe(@"\\fs02\dfs\four");
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Matter') AND name IN ('DmsPath', 'DfsPath')")).ShouldBe(0);

        // Several per kind go in; the rules of the table hold: kind DMS or DFS, position 1 to 10 and once per kind, a real path, no deleting a matter that has paths.
        await ScalarAsync(cs, "INSERT dbo.MatterPath (MatterId, Kind, Position, Path) SELECT MatterId, 'DMS', 2, N'https://dms.example.com/second' FROM dbo.Matter WHERE MatterNumber = '00001'");
        await ScalarAsync(cs, "INSERT dbo.MatterPath (MatterId, Kind, Position, Path) SELECT MatterId, 'DMS', 10, N'https://dms.example.com/tenth' FROM dbo.Matter WHERE MatterNumber = '00001'");
        var again = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.MatterPath (MatterId, Kind, Position, Path) SELECT MatterId, 'DMS', 2, N'https://x.example.com' FROM dbo.Matter WHERE MatterNumber = '00001'"));
        again.Message.ShouldContain("UQ_MatterPath_MatterKindPosition");
        var eleventh = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.MatterPath (MatterId, Kind, Position, Path) SELECT MatterId, 'DMS', 11, N'https://x.example.com' FROM dbo.Matter WHERE MatterNumber = '00001'"));
        eleventh.Message.ShouldContain("CK_MatterPath_Position");
        var kind = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.MatterPath (MatterId, Kind, Position, Path) SELECT MatterId, 'XYZ', 3, N'https://x.example.com' FROM dbo.Matter WHERE MatterNumber = '00001'"));
        kind.Message.ShouldContain("CK_MatterPath_Kind");
        var empty = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.MatterPath (MatterId, Kind, Position, Path) SELECT MatterId, 'DFS', 3, N'' FROM dbo.Matter WHERE MatterNumber = '00001'"));
        empty.Message.ShouldContain("CK_MatterPath_Path");
        var inUse = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "DELETE dbo.Matter WHERE MatterNumber = '00001'"));
        inUse.Message.ShouldContain("FK_MatterPath_Matter");
    }
}
