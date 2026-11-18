using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Script 83 (epic #1405, issue #1407): note folders. A folder, its parent and its notes stay in one matter; names are unique inside a parent; nothing cascades.</summary>
[Collection(SqlServerCollection.Name)]
public class NoteFoldersSchemaTests(SqlServerFixture sql)
{
    private static async Task<object?> ScalarAsync(string cs, string text)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = text;
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task<string> FailureAsync(string cs, string text) => (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, text), text)).Message;

    private async Task<(string Cs, int A, int B)> SeedAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        var client = (int)(await ScalarAsync(cs, "INSERT dbo.Client (ClientNumber, Name) VALUES ('00001', N'Client'); SELECT CAST(SCOPE_IDENTITY() AS INT);"))!;
        var a = (int)(await ScalarAsync(cs, $"INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) VALUES ({client}, '00001', '00001', N'Matter A'); SELECT CAST(SCOPE_IDENTITY() AS INT);"))!;
        var b = (int)(await ScalarAsync(cs, $"INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) VALUES ({client}, '00001', '00002', N'Matter B'); SELECT CAST(SCOPE_IDENTITY() AS INT);"))!;
        return (cs, a, b);
    }

    private static Task<object?> FolderAsync(string cs, int matter, string name, int? parent = null) =>
        ScalarAsync(cs, $"INSERT dbo.NoteFolder (MatterId, ParentFolderId, Name) VALUES ({matter}, {(parent is null ? "NULL" : parent.ToString())}, N'{name}'); SELECT CAST(SCOPE_IDENTITY() AS INT);");

    [Fact]
    public async Task A_folder_name_is_unique_inside_its_parent_also_at_the_top_level_and_ignoring_case()
    {
        var (cs, a, b) = await SeedAsync();
        var parent = (int)(await FolderAsync(cs, a, "Custodians"))!;
        var other = (int)(await FolderAsync(cs, a, "Records"))!;

        (await FailureAsync(cs, $"INSERT dbo.NoteFolder (MatterId, Name) VALUES ({a}, N'custodians')")).ShouldContain("UQ_NoteFolder_Name"); // top level
        await FolderAsync(cs, a, "Finance", parent);
        (await FailureAsync(cs, $"INSERT dbo.NoteFolder (MatterId, ParentFolderId, Name) VALUES ({a}, {parent}, N'FINANCE')")).ShouldContain("UQ_NoteFolder_Name");
        await FolderAsync(cs, a, "Finance", other); // another parent
        await FolderAsync(cs, b, "Custodians"); // another matter
    }

    [Fact]
    public async Task A_parent_and_a_note_folder_must_belong_to_the_same_matter()
    {
        var (cs, a, b) = await SeedAsync();
        var folder = (int)(await FolderAsync(cs, a, "Custodians"))!;
        var note = (int)(await ScalarAsync(cs, $"INSERT dbo.Note (MatterId) VALUES ({b}); SELECT CAST(SCOPE_IDENTITY() AS INT);"))!;

        (await FailureAsync(cs, $"INSERT dbo.NoteFolder (MatterId, ParentFolderId, Name) VALUES ({b}, {folder}, N'Child')")).ShouldContain("FK_NoteFolder_Parent");
        (await FailureAsync(cs, $"UPDATE dbo.Note SET FolderId = {folder} WHERE NoteId = {note}")).ShouldContain("FK_Note_Folder");
        (await FailureAsync(cs, $"UPDATE dbo.NoteFolder SET ParentFolderId = NoteFolderId WHERE NoteFolderId = {folder}")).ShouldContain("CK_NoteFolder_NotOwnParent");
    }

    [Fact]
    public async Task A_folder_that_holds_a_note_or_a_subfolder_cannot_be_deleted_and_a_note_may_have_no_folder()
    {
        var (cs, a, _) = await SeedAsync();
        var parent = (int)(await FolderAsync(cs, a, "Custodians"))!;
        var child = (int)(await FolderAsync(cs, a, "Executive Team", parent))!;
        await ScalarAsync(cs, $"INSERT dbo.Note (MatterId, FolderId) VALUES ({a}, {child}); INSERT dbo.Note (MatterId) VALUES ({a});");

        (await FailureAsync(cs, $"DELETE dbo.NoteFolder WHERE NoteFolderId = {parent}")).ShouldContain("FK_NoteFolder_Parent");
        (await FailureAsync(cs, $"DELETE dbo.NoteFolder WHERE NoteFolderId = {child}")).ShouldContain("FK_Note_Folder");
        (await ScalarAsync(cs, $"SELECT COUNT(*) FROM dbo.Note WHERE MatterId = {a} AND FolderId IS NULL")).ShouldBe(1); // no backfill, no default folder
    }

    [Theory]
    [InlineData("a/b")]
    [InlineData("a\\b")]
    [InlineData("   ")]
    public async Task A_folder_name_is_not_empty_and_has_no_slash(string name)
    {
        var (cs, a, _) = await SeedAsync();

        (await FailureAsync(cs, $"INSERT dbo.NoteFolder (MatterId, Name) VALUES ({a}, N'{name}')")).ShouldContain("CK_NoteFolder_Name");
    }
}
