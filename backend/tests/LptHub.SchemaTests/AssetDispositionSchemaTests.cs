using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Asset disposition (epic #851, issue #864; baseline, formerly script 43): the disposition columns, the index, the guard trigger and the IsActive/disposition agreement.</summary>
[Collection(SqlServerCollection.Name)]
public class AssetDispositionSchemaTests(SqlServerFixture sql)
{
    private static Task RunAsync(string cs, IMigrationScriptSource source) =>
        new SchemaMigrationRunner(cs, source, new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

    private static async Task<int> ExecAsync(string cs, string sqlText)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sqlText;
        return Convert.ToInt32(await cmd.ExecuteScalarAsync() ?? 0);
    }

    private static async Task ShouldRejectAsync(string cs, string sqlText, string expected)
    {
        var ex = await Should.ThrowAsync<SqlException>(() => ExecAsync(cs, sqlText));
        ex.Message.ShouldContain(expected, Case.Insensitive, sqlText);
    }

    private const string Seed = """
        INSERT dbo.Client (ClientNumber, Name) VALUES ('00343', N'Acme');
        INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) VALUES (1, '00343', '00012', N'One');
        INSERT dbo.AssetType (Name) VALUES (N'Document Set');
        INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName, IsActive) VALUES (1, 1, N'Live', 1), (1, 1, N'Retired', 0);
        """;

    [Fact]
    public async Task IsActive_and_the_disposition_must_agree_and_only_the_four_codes_exist()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new EmbeddedMigrationScriptSource());
        await ExecAsync(cs, Seed.Replace(", IsActive) VALUES (1, 1, N'Live', 1), (1, 1, N'Retired', 0)", ") VALUES (1, 1, N'Live')", StringComparison.Ordinal)
            .Replace("(MatterId, AssetTypeId, DisplayName, IsActive)", "(MatterId, AssetTypeId, DisplayName)", StringComparison.Ordinal));

        await ShouldRejectAsync(cs, "UPDATE dbo.Asset SET IsActive = 0 WHERE AssetId = 1", "CK_Asset_IsActive_Disposition");
        await ShouldRejectAsync(cs, "UPDATE dbo.Asset SET DispositionCode = 'DISPOSED' WHERE AssetId = 1", "CK_Asset_IsActive_Disposition");
        await ShouldRejectAsync(cs, "UPDATE dbo.Asset SET DispositionCode = 'GONE', IsActive = 0 WHERE AssetId = 1", "CK_Asset_DispositionCode");
        await ShouldRejectAsync(cs, "UPDATE dbo.Asset SET DispositionChangedByUserId = 999 WHERE AssetId = 1", "FK_Asset_DispositionChangedBy");

        foreach (var code in new[] { "INACTIVE", "PENDING_DISPOSITION", "DISPOSED" })
            await ExecAsync(cs, $"UPDATE dbo.Asset SET DispositionCode = '{code}', IsActive = 0, DispositionChangedAt = SYSUTCDATETIME(), DispositionNote = N'x' WHERE AssetId = 1");
        await ExecAsync(cs, "UPDATE dbo.Asset SET DispositionCode = 'ACTIVE', IsActive = 1 WHERE AssetId = 1");
    }
}
