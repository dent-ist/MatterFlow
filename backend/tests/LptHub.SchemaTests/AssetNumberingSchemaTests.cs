using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Asset numbering (issue #1297; baseline, formerly script 63): the numbering settings, the number columns, the unique index, the counter table and the guard trigger.</summary>
[Collection(SqlServerCollection.Name)]
public class AssetNumberingSchemaTests(SqlServerFixture sql)
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
        INSERT dbo.Client (ClientNumber, Name) VALUES ('90003', N'Acme');
        INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) VALUES (1, '90003', '80008', N'One'), (1, '90003', '80009', N'Two');
        INSERT dbo.AssetType (Name) VALUES (N'Media'), (N'Document Set');
        INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName) VALUES (1, 1, N'Existing media');
        """;

    [Fact]
    public async Task The_columns_the_index_the_counter_table_and_the_trigger_exist()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        foreach (var (table, column) in new[] { ("AssetType", "NumberingEnabled"), ("AssetType", "NumberingPattern"), ("AssetType", "NumberingScope"), ("Asset", "AssetNumber"), ("Asset", "AssetNumberSeq"), ("AssetNumberCounter", "AssetTypeId"), ("AssetNumberCounter", "ScopeKey"), ("AssetNumberCounter", "NextNumber") })
            (await ExecAsync(cs, $"SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('dbo.{table}') AND name = '{column}'")).ShouldBe(1, $"{table}.{column}");

        (await ExecAsync(cs, "SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AssetType' AND COLUMN_NAME = 'NumberingPattern'")).ShouldBe(150);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.indexes WHERE name = 'UQ_Asset_AssetNumber' AND object_id = OBJECT_ID('dbo.Asset') AND is_unique = 1 AND has_filter = 1 AND filter_definition LIKE '%AssetNumber%IS NOT NULL%'")).ShouldBe(1);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.index_columns ic JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id WHERE i.name = 'UQ_Asset_AssetNumber' AND ic.is_included_column = 0")).ShouldBe(3);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.key_constraints WHERE name = 'PK_AssetNumberCounter' AND type = 'PK'")).ShouldBe(1);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.index_columns ic JOIN sys.key_constraints k ON k.parent_object_id = ic.object_id AND k.unique_index_id = ic.index_id WHERE k.name = 'PK_AssetNumberCounter'")).ShouldBe(2);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.triggers WHERE name = 'TR_Asset_Guard' AND is_disabled = 0")).ShouldBe(1);
    }

    [Fact]
    public async Task The_numbering_settings_are_checked_by_the_database()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new EmbeddedMigrationScriptSource());
        await ExecAsync(cs, "INSERT dbo.AssetType (Name) VALUES (N'Media')");

        await ShouldRejectAsync(cs, "UPDATE dbo.AssetType SET NumberingScope = 2", "CK_AssetType_NumberingScope");
        await ShouldRejectAsync(cs, "UPDATE dbo.AssetType SET NumberingPattern = N''", "CK_AssetType_NumberingPattern");
        await ShouldRejectAsync(cs, $"UPDATE dbo.AssetType SET NumberingPattern = N'{new string('x', 51)}'", "CK_AssetType_NumberingPattern");
        await ExecAsync(cs, "UPDATE dbo.AssetType SET NumberingEnabled = 1, NumberingPattern = N'-M-{###}'");
    }

    [Fact]
    public async Task The_counter_has_one_row_per_type_and_scope_and_never_goes_below_one()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new EmbeddedMigrationScriptSource());
        await ExecAsync(cs, Seed);
        await ExecAsync(cs, "INSERT dbo.AssetNumberCounter (AssetTypeId, ScopeKey, NextNumber) VALUES (1, 1, 2), (1, 2, 2), (2, 1, 2)");

        await ShouldRejectAsync(cs, "INSERT dbo.AssetNumberCounter (AssetTypeId, ScopeKey, NextNumber) VALUES (1, 1, 9)", "PK_AssetNumberCounter");
        await ShouldRejectAsync(cs, "INSERT dbo.AssetNumberCounter (AssetTypeId, ScopeKey, NextNumber) VALUES (1, 3, 0)", "CK_AssetNumberCounter_Next");
        await ShouldRejectAsync(cs, "INSERT dbo.AssetNumberCounter (AssetTypeId, ScopeKey, NextNumber) VALUES (99, 1, 1)", "FK_AssetNumberCounter_AssetType");
    }

    [Fact]
    public async Task A_number_is_unique_per_type_and_matter_and_comes_with_its_sequence()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new EmbeddedMigrationScriptSource());
        await ExecAsync(cs, Seed);
        await ExecAsync(cs, "INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName, AssetNumber, AssetNumberSeq) VALUES (1, 1, N'A', N'90003-80008_001', 1)");

        await ShouldRejectAsync(cs, "INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName, AssetNumber, AssetNumberSeq) VALUES (1, 1, N'B', N'90003-80008_001', 2)", "UQ_Asset_AssetNumber");
        // The same text in another matter or another type is another folder.
        await ExecAsync(cs, "INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName, AssetNumber, AssetNumberSeq) VALUES (2, 1, N'C', N'90003-80008_001', 1), (1, 2, N'D', N'90003-80008_001', 1)");
        // Assets without a number never collide.
        await ExecAsync(cs, "INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName) VALUES (1, 1, N'E'), (1, 1, N'F')");
        await ShouldRejectAsync(cs, "INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName, AssetNumber) VALUES (1, 1, N'G', N'x')", "CK_Asset_AssetNumber");
        await ShouldRejectAsync(cs, "INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName, AssetNumberSeq) VALUES (1, 1, N'H', 3)", "CK_Asset_AssetNumber");
    }

    [Fact]
    public async Task An_assigned_number_cannot_be_changed_or_removed_but_other_columns_can()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new EmbeddedMigrationScriptSource());
        await ExecAsync(cs, Seed);
        await ExecAsync(cs, "INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName, AssetNumber, AssetNumberSeq) VALUES (1, 1, N'A', N'90003-80008_001', 1)");

        await ShouldRejectAsync(cs, "UPDATE dbo.Asset SET AssetNumber = N'90003-80008_002' WHERE DisplayName = N'A'", "assigned once");
        await ShouldRejectAsync(cs, "UPDATE dbo.Asset SET AssetNumber = NULL, AssetNumberSeq = NULL WHERE DisplayName = N'A'", "assigned once");
        await ShouldRejectAsync(cs, "UPDATE dbo.Asset SET AssetNumberSeq = 7 WHERE DisplayName = N'A'", "assigned once");
        await ExecAsync(cs, "UPDATE dbo.Asset SET DisplayName = N'Renamed' WHERE DisplayName = N'A'");
        (await ExecAsync(cs, "SELECT COUNT(*) FROM dbo.Asset WHERE DisplayName = N'Renamed' AND AssetNumber = N'90003-80008_001'")).ShouldBe(1);
        // The older rules of the guard still hold.
        await ShouldRejectAsync(cs, "UPDATE dbo.Asset SET MatterId = 2 WHERE DisplayName = N'Renamed'", "cannot move");
        await ShouldRejectAsync(cs, "DELETE dbo.Asset WHERE DisplayName = N'Renamed'", "cannot be deleted");
    }
}
