using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>Constraints, indexes and the guard trigger of 10-assets.sql (docs/erd.md section 3).</summary>
[Collection(SqlServerCollection.Name)]
public class AssetsSchemaTests(SqlServerFixture sql)
{
    private async Task<string> MigratedAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        return cs;
    }

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

    private static async Task SeedAsync(string cs)
    {
        await ExecAsync(cs, """
            INSERT dbo.Client (ClientNumber, Name) VALUES ('00343', N'Acme');
            INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) VALUES (1, '00343', '00012', N'One'), (1, '00343', '00013', N'Two');
            INSERT dbo.AssetType (Name) VALUES (N'Document Set');
            INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName) VALUES (1, 1, N'Bundle');
            """);
    }

    [Fact]
    public async Task Asset_objects_exist_and_an_asset_has_exactly_one_matter()
    {
        var cs = await MigratedAsync();

        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.tables WHERE name IN ('AssetType','Asset')")).ShouldBe(2);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Asset') AND name = 'MatterId' AND is_nullable = 0")).ShouldBe(1);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.indexes WHERE name = 'UQ_Asset_IdMatter' AND is_unique_constraint = 1")).ShouldBe(1);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.triggers WHERE name = 'TR_Asset_Guard' AND is_disabled = 0")).ShouldBe(1);

        await SeedAsync(cs);
        await ShouldRejectAsync(cs, "INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName) VALUES (NULL, 1, N'x')", "MatterId");
        await ShouldRejectAsync(cs, "INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName) VALUES (99, 1, N'x')", "FK_Asset_Matter");
        await ShouldRejectAsync(cs, "INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName) VALUES (1, 99, N'x')", "FK_Asset_AssetType");
        await ShouldRejectAsync(cs, "INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName) VALUES (1, 1, N'   ')", "CK_Asset_DisplayName");
        await ShouldRejectAsync(cs, "INSERT dbo.AssetType (Name) VALUES (N'Document Set')", "UQ_AssetType_Name");
    }

    [Fact]
    public async Task An_asset_cannot_move_matter_or_be_deleted_but_can_be_deactivated()
    {
        var cs = await MigratedAsync();
        await SeedAsync(cs);

        await ShouldRejectAsync(cs, "UPDATE dbo.Asset SET MatterId = 2 WHERE AssetId = 1", "cannot move");
        await ShouldRejectAsync(cs, "DELETE dbo.Asset WHERE AssetId = 1", "cannot be deleted");
        await ExecAsync(cs, "UPDATE dbo.Asset SET IsActive = 0, DisplayName = N'Renamed' WHERE AssetId = 1");
        (await ExecAsync(cs, "SELECT COUNT(*) FROM dbo.Asset WHERE MatterId = 1 AND IsActive = 0")).ShouldBe(1);
    }

    [Fact]
    public async Task A_form_definition_owner_key_must_be_an_existing_asset_type()
    {
        var cs = await MigratedAsync();
        await SeedAsync(cs);

        await ShouldRejectAsync(cs, "INSERT dbo.FormDefinition (Scope, AssetTypeId) VALUES ('ASSET_TYPE', 99)", "FK_FormDef_AssetType");
        await ExecAsync(cs, "INSERT dbo.FormDefinition (Scope, AssetTypeId) VALUES ('ASSET_TYPE', 1)");
    }
}
